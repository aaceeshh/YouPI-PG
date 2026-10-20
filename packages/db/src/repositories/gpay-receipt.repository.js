export class GpayReceiptRepository {
  constructor(db) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS gpay_dashboard_links (
      receiving_account_id TEXT PRIMARY KEY REFERENCES payment_receiving_accounts(id), dashboard_merchant_id TEXT NOT NULL,
      linked_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS gpay_dashboard_receipts (
      receiving_account_id TEXT NOT NULL REFERENCES payment_receiving_accounts(id), dashboard_merchant_id TEXT NOT NULL,
      rrn TEXT NOT NULL, amount_paise INTEGER NOT NULL, received_at TEXT NOT NULL,
      first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL,
      PRIMARY KEY(receiving_account_id,rrn));`);
  }
  link(accountId, dashboardId) {
    if (typeof dashboardId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(dashboardId)) throw new Error('Invalid dashboard merchant ID');
    const old = this.db.queryOne('SELECT * FROM gpay_dashboard_links WHERE receiving_account_id=?', [accountId]);
    if (old && old.dashboard_merchant_id !== dashboardId) throw new Error('Dashboard mapping already exists; review it before changing receiving accounts');
    this.db.execute('INSERT OR IGNORE INTO gpay_dashboard_links VALUES(?,?,?)', [accountId, dashboardId, new Date().toISOString()]);
  }
  ingest({ receivingAccountId, dashboardMerchantId, receipts }, now = Date.now()) {
    const link = this.db.queryOne('SELECT * FROM gpay_dashboard_links WHERE receiving_account_id=?', [receivingAccountId]);
    if (!link || link.dashboard_merchant_id !== dashboardMerchantId) throw new Error('Dashboard must be linked by an admin first');
    if (!Array.isArray(receipts) || receipts.length > 100) throw new Error('Invalid receipt batch');
    return this.db.transaction(() => {
      for (const receipt of receipts) {
        const time = Date.parse(receipt.receivedAt);
        if (receipt.status !== 'Settled' || typeof receipt.rrn !== 'string' || !/^\d{12}$/.test(receipt.rrn) ||
            !Number.isSafeInteger(receipt.amountPaise) || receipt.amountPaise < 1 || receipt.amountPaise > 100000000 ||
            typeof receipt.receivedAt !== 'string' || !Number.isFinite(time) ||
            new Date(time).toISOString() !== receipt.receivedAt || time > now + 60000) throw new Error('Invalid settled receipt');
        const old = this.db.queryOne('SELECT * FROM gpay_dashboard_receipts WHERE receiving_account_id=? AND rrn=?', [receivingAccountId, receipt.rrn]);
        if (old && (old.amount_paise !== receipt.amountPaise || old.received_at !== receipt.receivedAt)) throw new Error('RECEIPT_CONFLICT');
        this.db.execute(`INSERT INTO gpay_dashboard_receipts VALUES(?,?,?,?,?,?,?)
          ON CONFLICT(receiving_account_id,rrn) DO UPDATE SET last_seen_at=excluded.last_seen_at`,
        [receivingAccountId, dashboardMerchantId, receipt.rrn, receipt.amountPaise, receipt.receivedAt, new Date(now).toISOString(), new Date(now).toISOString()]);
      }
      return { accepted: true, count: receipts.length, walletCredit: false, reviewRequired: true };
    });
  }
  recent(accountId) {
    return this.db.query('SELECT * FROM gpay_dashboard_receipts WHERE receiving_account_id=? ORDER BY received_at DESC LIMIT 100', [accountId]);
  }
}
