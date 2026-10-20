import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

export class ReceiptOutbox {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS receipts (merchant_id TEXT NOT NULL, rrn TEXT NOT NULL, payload TEXT NOT NULL,
      delivered INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(merchant_id,rrn));`);
  }
  enqueue(merchantId, receipts, now = Date.now()) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const receipt of receipts) {
        if (Date.parse(receipt.receivedAt) > now + 60000) throw new Error('FUTURE_RECEIPT');
        if (receipt.status !== 'Settled') continue;
        const payload = JSON.stringify(receipt);
        const old = this.db.prepare('SELECT payload FROM receipts WHERE merchant_id=? AND rrn=?').get(merchantId, receipt.rrn);
        if (old && old.payload !== payload) throw new Error('RECEIPT_CONFLICT');
        this.db.prepare('INSERT OR IGNORE INTO receipts(merchant_id,rrn,payload) VALUES(?,?,?)').run(merchantId, receipt.rrn, payload);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  pending(merchantId) {
    return this.db.prepare('SELECT payload FROM receipts WHERE merchant_id=? AND delivered=0 ORDER BY rrn LIMIT 100').all(merchantId).map(row => JSON.parse(row.payload));
  }
  acknowledge(merchantId, receipts) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const receipt of receipts) this.db.prepare('UPDATE receipts SET delivered=1 WHERE merchant_id=? AND rrn=? AND payload=?').run(merchantId, receipt.rrn, JSON.stringify(receipt));
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
