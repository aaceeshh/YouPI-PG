import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { GpayReceiptRepository } from '../../../../packages/db/src/repositories/gpay-receipt.repository.js';
import { authGuard } from '../auth-guard.js';
import { Database } from '@youpi/db';
import { createPaymentApp } from '../index.js';
import { TEST_ADMIN_TOKEN, TEST_OBSERVER_TOKEN } from '../../../../scripts/test-support.js';

test('dashboard receipt ingestion requires mapping, rejects conflicting replays, and cannot settle orders', () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec("PRAGMA foreign_keys=ON; CREATE TABLE payment_receiving_accounts(id TEXT PRIMARY KEY); INSERT INTO payment_receiving_accounts VALUES('ACCOUNT'); CREATE TABLE payment_sessions(id TEXT PRIMARY KEY,status TEXT); INSERT INTO payment_sessions VALUES('ORDER','ACTIVE');");
  const db = {
    exec: sql => sqlite.exec(sql),
    queryOne: (sql, params) => sqlite.prepare(sql).get(...params),
    query: (sql, params) => sqlite.prepare(sql).all(...params),
    execute: (sql, params) => sqlite.prepare(sql).run(...params),
    transaction: action => { sqlite.exec('BEGIN'); try { const result = action(); sqlite.exec('COMMIT'); return result; } catch (error) { sqlite.exec('ROLLBACK'); throw error; } }
  };
  try {
    const repo = new GpayReceiptRepository(db);
    const receipt = { rrn: '001234567890', amountPaise: 1000, receivedAt: '2026-10-03T09:33:00.000Z', status: 'Settled' };
    const batch = { receivingAccountId: 'ACCOUNT', dashboardMerchantId: 'DASHBOARD', receipts: [receipt] };
    assert.throws(() => repo.ingest(batch), /linked/);
    repo.link('ACCOUNT', 'DASHBOARD');
    assert.throws(() => repo.link('ACCOUNT', 'OTHER'), /already exists/);
    assert.equal(repo.ingest(batch).reviewRequired, true);
    assert.equal(repo.ingest(batch).walletCredit, false);
    assert.equal(repo.recent('ACCOUNT').length, 1);
    assert.throws(() => repo.ingest({ ...batch, receipts: [{ ...receipt, amountPaise: 2000 }] }), /CONFLICT/);
    assert.throws(() => repo.ingest({ ...batch, receipts: [{ ...receipt, status: 'Scheduled to settle' }] }));
    assert.equal(sqlite.prepare('SELECT status FROM payment_sessions').get().status, 'ACTIVE');
  } finally { sqlite.close(); }
});

test('anonymous dashboard receipt submissions and private receipt reads require authentication', () => {
  for (const [method, pathname] of [['POST', '/api/v1/pollers/gpay/receipts'], ['GET', '/api/v1/admin/gpay/receipts/ACCOUNT']]) {
    let status;
    const response = { writeHead: code => { status = code; }, end: () => {} };
    assert.equal(authGuard({ method, headers: {} }, response, pathname, new URL(`http://localhost${pathname}`)), true);
    assert.equal(status, 401);
  }
});

test('HTTP intake enforces separate admin/observer access, exact account mapping and review-only results', async () => {
  const db = new Database({ inMemory: true });
  const app = createPaymentApp(db);
  await new Promise(resolve => app.rawServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.rawServer.address().port}`;
  const call = (path, token, input) => fetch(`${origin}${path}`, {
    method: input === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(input === undefined ? {} : { body: JSON.stringify(input) })
  });
  try {
    const account = app.context.accountRepo.findActiveForMerchant(app.context.defaultMerchant.id);
    const input = { receivingAccountId: account.id, dashboardMerchantId: 'TEST_DASHBOARD', payeeVpa: account.upiId,
      receipts: [{ rrn: '001234567890', amountPaise: 1000, receivedAt: '2026-10-03T09:33:00.000Z', status: 'Settled' }] };
    const session = app.context.sessionRepo.create({ merchantId: app.context.defaultMerchant.id, receivingAccountId: account.id,
      orderId: 'GPAY_REVIEW_TEST', amountPaise: 1000n, method: 'UPI', status: 'ACTIVE' });
    let successes = 0;
    app.context.eventEmitter.on('PAYMENT.SUCCESS', () => successes++);
    assert.equal((await call('/api/v1/pollers/gpay/receipts', null, input)).status, 401);
    assert.equal((await call('/api/v1/pollers/gpay/receipts', TEST_OBSERVER_TOKEN, input)).status, 409);
    assert.equal((await call('/api/v1/admin/gpay/link', TEST_OBSERVER_TOKEN, { ...input, ownershipVerified: true })).status, 401);
    assert.equal((await call('/api/v1/admin/gpay/link', TEST_ADMIN_TOKEN, { ...input, ownershipVerified: true })).status, 200);
    assert.equal((await call('/api/v1/pollers/gpay/receipts', TEST_OBSERVER_TOKEN, { ...input, payeeVpa: 'wrong@upi' })).status, 409);
    assert.equal((await call('/api/v1/pollers/gpay/receipts', TEST_OBSERVER_TOKEN, null)).status, 400);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await call('/api/v1/pollers/gpay/receipts', TEST_OBSERVER_TOKEN, input);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).walletCredit, false);
    }
    assert.equal((await call(`/api/v1/admin/gpay/receipts/${account.id}`, TEST_OBSERVER_TOKEN)).status, 401);
    const review = await call(`/api/v1/admin/gpay/receipts/${account.id}`, TEST_ADMIN_TOKEN);
    assert.equal((await review.json()).receipts.length, 1);
    assert.equal(app.context.sessionRepo.findById(session.id).status, 'ACTIVE');
    assert.equal(successes, 0);
  } finally {
    app.destroy();
    await new Promise(resolve => app.rawServer.close(resolve));
    db.close();
  }
});
