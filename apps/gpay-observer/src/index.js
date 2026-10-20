import { chromium } from 'playwright';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { configuration } from './config.js';
import { scanDashboard, readDashboardPage } from './dashboard.js';
import { ReceiptOutbox } from './store.js';

const config = configuration();
const login = process.argv.includes('--login');
const once = process.argv.includes('--once');
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => abort.abort());
const outbox = new ReceiptOutbox(config.dbPath);
let context;

function health(status, pages = 0) {
  mkdirSync(dirname(config.healthPath), { recursive: true, mode: 0o700 });
  writeFileSync(`${config.healthPath}.tmp`, JSON.stringify({ status, pages, updatedAt: new Date().toISOString() }), { mode: 0o600 });
  renameSync(`${config.healthPath}.tmp`, config.healthPath);
  console.log(`Google Pay observer: ${status}`);
}

async function deliver(receipts) {
  const response = await fetch(`${config.apiUrl}/api/v1/pollers/gpay/receipts`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}` },
    body: JSON.stringify({ dashboardMerchantId: config.merchantId, receivingAccountId: config.receivingAccountId,
      payeeVpa: config.payeeVpa, receipts })
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.accepted !== true) throw new Error('DELIVERY_FAILED');
  outbox.acknowledge(config.merchantId, receipts);
}

try {
  health('STARTING');
  context = await chromium.launchPersistentContext(config.profileDir, {
    headless: login ? false : config.headless,
    ...(config.channel === 'chromium' ? {} : { channel: config.channel }),
    locale: 'en-IN', timezoneId: 'Asia/Kolkata', acceptDownloads: false
  });
  const page = context.pages()[0] || await context.newPage();
  page.setDefaultTimeout(15000);
  if (login) {
    await page.goto(config.transactionsUrl);
    console.log('Sign in to your merchant account and complete MFA yourself. No password is stored by this worker.');
    const input = createInterface({ input: process.stdin, output: process.stdout });
    try { await input.question('When the Transactions table is visible, press Enter: '); }
    finally { input.close(); }
    await readDashboardPage(page, config.transactionsUrl);
    health('LOGIN_SAVED');
  } else {
    while (!abort.signal.aborted) {
      const { receipts, pages } = await scanDashboard(page, config);
      outbox.enqueue(config.merchantId, receipts);
      try {
        let pending = outbox.pending(config.merchantId);
        if (!pending.length) await deliver([]);
        while (pending.length) {
          await deliver(pending);
          pending = outbox.pending(config.merchantId);
        }
        health('HEALTHY', pages);
      } catch {
        health('DELIVERY_FAILED', pages);
        if (once) throw new Error('DELIVERY_FAILED');
      }
      if (once) break;
      await sleep(config.pollSeconds * 1000, undefined, { signal: abort.signal });
    }
  }
} catch (error) {
  if (!abort.signal.aborted) {
    const known = ['LOGIN_REQUIRED', 'DASHBOARD_CHANGED', 'DASHBOARD_ORDER_CHANGED', 'PAGINATION_STALLED', 'SCAN_LIMIT_REACHED', 'RECEIPT_CONFLICT', 'FUTURE_RECEIPT', 'DELIVERY_FAILED'];
    health(known.includes(error.message) ? error.message : 'OBSERVER_ERROR');
    process.exitCode = 1;
  }
} finally {
  if (context) await context.close();
  outbox.close();
  if (abort.signal.aborted) health('STOPPED');
}
