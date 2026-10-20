import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { scanDashboard } from './src/dashboard.js';

test('actual browser reads the dashboard fixture, traverses pages, and stops on unknown status', async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.GPAY_TEST_CHANNEL ? { channel: process.env.GPAY_TEST_CHANNEL } : {}) });
  try {
    const page = await browser.newPage();
    const transactionsUrl = 'https://pay.google.com/g4b/transactions/FIXTURE';
    let broken = false;
    await page.route(transactionsUrl, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en"><body>
      <div role="combobox" aria-label="Date range" tabindex="0">Date range</div><div role="option">Always</div>
      <div role="combobox" aria-label="Select transaction status" tabindex="0">Status</div><div role="option">Any status</div>
      <table><thead><tr><th aria-sort="descending">Date</th><th>Payer</th><th></th><th>UPI transaction ID</th><th>Payment app</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody><tr><td>15:03 3 Oct 2026</td><td>Masked name</td><td></td><td id="rrn">001234567890</td><td>PhonePe</td><td>INR 10.00</td><td>${broken ? 'Unknown' : 'Settled'}</td></tr></tbody></table>
      <button aria-label="Go to next page" onclick="document.getElementById('rrn').textContent='001234567891';this.disabled=true">Next</button>
      </body></html>` }));
    const result = await scanDashboard(page, { transactionsUrl, maxPages: 2 }, Date.parse('2026-10-03T10:00Z'));
    assert.equal(result.pages, 2);
    assert.deepEqual(result.receipts.map(receipt => receipt.rrn), ['001234567890', '001234567891']);
    assert.equal(result.receipts[0].amountPaise, 1000);
    broken = true;
    await assert.rejects(scanDashboard(page, { transactionsUrl, maxPages: 2 }, Date.parse('2026-10-03T10:00Z')), /DASHBOARD_CHANGED/);
  } finally { await browser.close(); }
});
