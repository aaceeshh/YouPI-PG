import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dashboardMerchantId, configuration } from '../config.js';
import { parseTable, parseReceipt, scanDashboard } from '../dashboard.js';
import { ReceiptOutbox } from '../store.js';

const headers = ['Date', 'Payer', '', 'UPI transaction ID', 'Payment app', 'Amount', 'Status'];
const row = ['15:03 3 Oct 2026', 'Masked payer', '', '001234567890', 'PhonePe', '\u20b91,00,000.50', 'Settled'];
const fixture = () => parseTable([headers, row])[0];

test('only the exact Google Pay Transactions merchant path is accepted', () => {
  assert.equal(dashboardMerchantId('https://pay.google.com/g4b/transactions/TEST_MERCHANT'), 'TEST_MERCHANT');
  for (const url of ['https://pay.google.com.evil.test/g4b/transactions/X', 'http://pay.google.com/g4b/transactions/X',
    'https://pay.google.com/g4b/settings/X', 'https://pay.google.com/g4b/transactions/X?auth=secret']) assert.throws(() => dashboardMerchantId(url));
  assert.throws(() => configuration({ GPAY_TRANSACTIONS_URL: 'https://pay.google.com/g4b/transactions/X', GPAY_POLL_SECONDS: '1' }));
});

test('receipts preserve leading zeroes, exact paise and IST date conversion without retaining payer data', () => {
  const receipt = fixture();
  assert.equal(receipt.rrn, '001234567890');
  assert.equal(receipt.amountPaise, 10000050);
  assert.equal(receipt.receivedAt, '2026-10-03T09:33:00.000Z');
  assert.equal(JSON.stringify(receipt).includes('Masked payer'), false);
  assert.equal(parseTable([headers.filter(Boolean), row.filter((_, i) => i !== 2)])[0].rrn, receipt.rrn);
});

test('changed columns, unknown status, invalid dates and malformed amounts stop parsing', () => {
  assert.throws(() => parseTable([headers.slice(1), row]));
  assert.throws(() => parseTable([headers, row.map((v, i) => i === 6 ? 'Success' : v)]));
  assert.throws(() => parseTable([headers, row.map((v, i) => i === 2 ? 'Unexpected' : v)]));
  for (const time of ['15:03 31 Feb 2026', '25:03 3 Oct 2026', 'Yesterday']) {
    assert.throws(() => parseReceipt([time, '', '001234567890', '', '2.00', 'Settled']));
  }
  for (const amount of ['1e5', '1,2,3.00', '-2', '2.001']) {
    assert.throws(() => parseReceipt(['15:03 3 Oct 2026', '', '001234567890', '', amount, 'Settled']));
  }
});

test('outbox survives restart and lost acknowledgements, deduplicates, and rejects conflicting receipts atomically', () => {
  const dir = mkdtempSync(join(tmpdir(), 'youpi-gpay-test-'));
  const file = join(dir, 'outbox.sqlite');
  let store = new ReceiptOutbox(file);
  try {
    store.enqueue('MERCHANT', [fixture(), { ...fixture(), rrn: '111234567890', status: 'Scheduled to settle' }]);
    store.close();
    store = new ReceiptOutbox(file);
    assert.equal(store.pending('MERCHANT').length, 1);
    store.enqueue('MERCHANT', [fixture()]);
    assert.equal(store.pending('MERCHANT').length, 1);
    assert.throws(() => store.enqueue('MERCHANT', [{ ...fixture(), rrn: '221234567890' }, { ...fixture(), amountPaise: 1 }]));
    assert.equal(store.pending('MERCHANT').length, 1);
    store.acknowledge('MERCHANT', [fixture()]);
    assert.equal(store.pending('MERCHANT').length, 0);
    assert.throws(() => store.enqueue('MERCHANT', [{ ...fixture(), receivedAt: '2099-01-01T00:00:00.000Z' }]));
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a scan that reaches the page limit never publishes a truncated receipt list', async () => {
  const page = {
    goto: async () => {}, url: () => 'https://pay.google.com/g4b/transactions/X',
    getByText: () => ({ count: async () => 0 }),
    getByRole: role => role === 'table' ? {
      waitFor: async () => {}, count: async () => 1, evaluate: async () => ({ sort: 'descending', raw: [headers, row] })
    } : role === 'combobox' ? { count: async () => 2, nth: () => ({ click: async () => {} }), click: async () => {} }
      : { click: async () => {}, count: async () => 1, isEnabled: async () => true }
  };
  await assert.rejects(scanDashboard(page, { transactionsUrl: page.url(), maxPages: 1 }, Date.parse('2026-10-03T10:00Z')), /SCAN_LIMIT_REACHED/);
  const historical = await scanDashboard(page, { transactionsUrl: page.url(), maxPages: 1 }, Date.parse('2026-10-20T10:00Z'));
  assert.equal(historical.receipts.length, 0);
});
