import { HttpServer } from '../server.js';
import { GpayReceiptRepository } from '../../../../packages/db/src/repositories/gpay-receipt.repository.js';

async function readObject(req, res) {
  try {
    const input = await HttpServer.parseBody(req);
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid object');
    return input;
  } catch {
    HttpServer.json(res, 400, { error: 'Invalid receipt request' });
    return null;
  }
}

export function registerGpayRoutes(server, ctx) {
  const receipts = new GpayReceiptRepository(ctx.db);
  server.post('/api/v1/admin/gpay/link', async (req, res) => {
    const input = await readObject(req, res);
    if (!input) return;
    const account = ctx.accountRepo.findById(input.receivingAccountId);
    if (!account || account.upiId !== input.payeeVpa || input.ownershipVerified !== true) {
      return HttpServer.json(res, 400, { error: 'Confirm the receiving account and its dashboard ownership' });
    }
    try {
      receipts.link(account.id, input.dashboardMerchantId);
      ctx.auditRepo.log({ merchantId: account.merchantId, entityType: 'RECEIVING_ACCOUNT', entityId: account.id,
        action: 'GPAY_DASHBOARD_LINKED', actorType: 'ADMIN',
        details: { dashboardMerchantId: input.dashboardMerchantId } });
      return HttpServer.json(res, 200, { linked: true });
    } catch (error) { return HttpServer.json(res, 409, { error: error.message }); }
  });
  server.post('/api/v1/pollers/gpay/receipts', async (req, res) => {
    const input = await readObject(req, res);
    if (!input) return;
    const account = ctx.accountRepo.findById(input.receivingAccountId);
    if (!account || !account.isActive || account.upiId !== input.payeeVpa) {
      return HttpServer.json(res, 409, { error: 'Receiving account mismatch' });
    }
    try {
      // A dashboard receipt proves receipt detection, not ownership of a reseller order.
      // Deliberately bypass the amount-based attribution engine and wallet mutations.
      return HttpServer.json(res, 200, receipts.ingest(input));
    } catch (error) { return HttpServer.json(res, 409, { error: error.message }); }
  });
  server.get('/api/v1/admin/gpay/receipts/:accountId', async (_req, res, params) => {
    if (!ctx.accountRepo.findById(params.accountId)) return HttpServer.json(res, 404, { error: 'Account not found' });
    return HttpServer.json(res, 200, { receipts: receipts.recent(params.accountId), reviewRequired: true });
  });
}
