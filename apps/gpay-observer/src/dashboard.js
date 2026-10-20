const columns = ['Date', 'Payer', 'UPI transaction ID', 'Payment app', 'Amount', 'Status'];
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function parseReceipt(cells) {
  const [time, , rrn, , amount, status] = cells;
  if (!['Settled', 'Scheduled to settle'].includes(status) || !/^\d{12}$/.test(rrn)) throw new Error('DASHBOARD_CHANGED');
  const money = amount.replace(/^(?:\u20b9|INR)\s*/, '');
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(money)) throw new Error('INVALID_AMOUNT');
  const [whole, fraction = ''] = money.replaceAll(',', '').split('.');
  const amountPaise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0 || amountPaise > 100000000) throw new Error('INVALID_AMOUNT');
  const match = /^(\d{2}):(\d{2}) (\d{1,2}) ([A-Za-z]{3}) (\d{4})$/.exec(time);
  if (!match) throw new Error('INVALID_TIMESTAMP');
  const [, hour, minute, day, month, year] = match;
  const monthIndex = months.indexOf(month);
  const date = new Date(Date.UTC(+year, monthIndex, +day, +hour, +minute));
  if (monthIndex < 0 || +hour > 23 || +minute > 59 || +year < 2020 || date.getUTCDate() !== +day) throw new Error('INVALID_TIMESTAMP');
  return { rrn, amountPaise, receivedAt: new Date(date.getTime() - 330 * 60000).toISOString(), status };
}

export function parseTable(raw) {
  if (!raw.length || ![6, 7].includes(raw[0].length)) throw new Error('DASHBOARD_CHANGED');
  const indices = raw[0].flatMap((cell, i) => cell ? [i] : []);
  if (indices.map(i => raw[0][i]).join('|') !== columns.join('|')) throw new Error('DASHBOARD_CHANGED');
  return raw.slice(1).map(cells => {
    if (cells.length !== raw[0].length || raw[0].some((header, i) => !header && cells[i])) throw new Error('DASHBOARD_CHANGED');
    return parseReceipt(indices.map(i => cells[i]));
  });
}

export async function readDashboardPage(page, expectedUrl) {
  const current = new URL(page.url());
  if (current.origin !== 'https://pay.google.com' || current.pathname.replace(/\/$/, '') !== new URL(expectedUrl).pathname.replace(/\/$/, '')) {
    throw new Error('LOGIN_REQUIRED');
  }
  const tables = page.getByRole('table');
  if (await tables.count() !== 1) throw new Error('DASHBOARD_CHANGED');
  const snapshot = await tables.evaluate(table => ({
    sort: table.querySelector('th,[role="columnheader"]')?.getAttribute('aria-sort'),
    raw: Array.from(table.querySelectorAll('tr,[role="row"]')).map(row =>
      Array.from(row.querySelectorAll('td,th,[role="cell"],[role="columnheader"]')).map(cell => cell.innerText.trim().replace(/\s+/g, ' ')))
  }));
  if (snapshot.sort !== 'descending') throw new Error('DASHBOARD_ORDER_CHANGED');
  const raw = snapshot.raw;
  const receipts = parseTable(raw);
  if (!receipts.length && await page.getByText(/^0 transactions$/).count() !== 1) throw new Error('DASHBOARD_CHANGED');
  return receipts;
}

export async function scanDashboard(page, config, now = Date.now()) {
  const cutoff = now - (config.lookbackHours || 48) * 3600000;
  await page.goto(config.transactionsUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try { await page.getByRole('table').waitFor({ state: 'visible', timeout: 20000 }); }
  catch { throw new Error(new URL(page.url()).hostname === 'accounts.google.com' ? 'LOGIN_REQUIRED' : 'DASHBOARD_CHANGED'); }
  const combos = page.getByRole('combobox');
  if (await combos.count() !== 2) throw new Error('DASHBOARD_CHANGED');
  await combos.nth(0).click();
  await page.getByRole('option', { name: 'Always', exact: true }).click();
  await page.getByRole('combobox', { name: 'Select transaction status' }).click();
  await page.getByRole('option', { name: 'Any status', exact: true }).click();
  const receipts = new Map();
  let previous = '';
  let lastTimestamp = Infinity;
  for (let pages = 1; pages <= config.maxPages; pages++) {
    const current = await readDashboardPage(page, config.transactionsUrl);
    const signature = current.map(receipt => receipt.rrn).join(',');
    if (pages > 1 && signature === previous) throw new Error('PAGINATION_STALLED');
    previous = signature;
    for (const receipt of current) {
      const timestamp = Date.parse(receipt.receivedAt);
      if (timestamp > lastTimestamp) throw new Error('DASHBOARD_ORDER_CHANGED');
      lastTimestamp = timestamp;
      if (timestamp < cutoff) continue;
      const old = receipts.get(receipt.rrn);
      if (old && JSON.stringify(old) !== JSON.stringify(receipt)) throw new Error('RECEIPT_CONFLICT');
      receipts.set(receipt.rrn, receipt);
    }
    if (!current.length || lastTimestamp < cutoff) return { receipts: [...receipts.values()], pages };
    const next = page.getByRole('button', { name: 'Go to next page', exact: true });
    if (await next.count() !== 1) throw new Error('DASHBOARD_CHANGED');
    if (!await next.isEnabled()) return { receipts: [...receipts.values()], pages };
    if (pages === config.maxPages) throw new Error('SCAN_LIMIT_REACHED');
    await next.click();
    await page.waitForFunction(oldIds => {
      const rows = Array.from(document.querySelectorAll('table tr,[role="table"] [role="row"]'));
      const cells = row => Array.from(row.querySelectorAll('td,th,[role="cell"],[role="columnheader"]'));
      if (!rows.length) return false;
      const index = cells(rows[0]).findIndex(cell => cell.innerText.trim() === 'UPI transaction ID');
      if (index < 0) return false;
      return rows.slice(1).map(row => cells(row)[index]?.innerText.trim()).join(',') !== oldIds;
    }, signature, { timeout: 15000 });
  }
  throw new Error('SCAN_LIMIT_REACHED');
}
