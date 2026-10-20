import { resolve } from 'node:path';

export function dashboardMerchantId(value) {
  const url = new URL(value);
  if (url.origin !== 'https://pay.google.com' || url.username || url.password || url.search || url.hash ||
      !/^\/g4b\/transactions\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) throw new Error('INVALID_DASHBOARD_URL');
  return url.pathname.split('/').filter(Boolean).at(-1);
}

export function configuration(env = process.env) {
  const transactionsUrl = env.GPAY_TRANSACTIONS_URL || '';
  const merchantId = dashboardMerchantId(transactionsUrl);
  const api = new URL(env.BASE_PAYMENT_API_URL || 'http://127.0.0.1:6100');
  if (api.username || api.password || api.search || api.hash || api.pathname !== '/' ||
      !(api.protocol === 'https:' || api.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(api.hostname))) {
    throw new Error('INVALID_API_URL');
  }
  const pollSeconds = Number(env.GPAY_POLL_SECONDS || 60);
  const maxPages = Number(env.GPAY_MAX_PAGES || 10);
  const lookbackHours = Number(env.GPAY_LOOKBACK_HOURS || 48);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 30 || pollSeconds > 3600) throw new Error('INVALID_POLL_INTERVAL');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 550) throw new Error('INVALID_PAGE_LIMIT');
  if (!Number.isInteger(lookbackHours) || lookbackHours < 24 || lookbackHours > 168) throw new Error('INVALID_LOOKBACK');
  if (!/^[a-f0-9-]{36}$/i.test(env.GPAY_RECEIVING_ACCOUNT_ID || '')) throw new Error('MISSING_RECEIVING_ACCOUNT');
  if (!/^[\w.\-]+@[\w.\-]+$/.test(env.GPAY_PAYEE_VPA || '')) throw new Error('MISSING_PAYEE_VPA');
  if ((env.OBSERVER_API_TOKEN || '').length < 32) throw new Error('MISSING_OBSERVER_TOKEN');
  return {
    transactionsUrl, merchantId, apiUrl: api.origin, token: env.OBSERVER_API_TOKEN,
    receivingAccountId: env.GPAY_RECEIVING_ACCOUNT_ID, payeeVpa: env.GPAY_PAYEE_VPA,
    pollSeconds, maxPages, lookbackHours, channel: env.GPAY_CHANNEL || 'chromium', headless: env.GPAY_HEADLESS !== 'false',
    profileDir: resolve(env.GPAY_PROFILE_DIR || 'data/browser-sessions/gpay'),
    dbPath: resolve(env.GPAY_OBSERVER_DB_PATH || 'data/gpay-observer.sqlite'),
    healthPath: resolve(env.GPAY_HEALTH_PATH || 'data/gpay-observer-health.json')
  };
}
