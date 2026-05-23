import { getUser } from '../../../foundation/modules/auth/index.js';
import { getProjectId } from '../../../foundation/modules/core/index.js';
import { createPendingCreditPurchaseByPackage, getCreditPackage } from '../../../foundation/modules/payments/index.js';
import { createOrder } from '../../../foundation/integrations/index.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const user = await getUser(request, env);
    if (!user) {
      return Response.json(
        { success: false, error: 'Login required', code: 'LOGIN_REQUIRED' },
        { status: 401 },
      );
    }

    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const { packId } = await request.json();
    const projectId = getProjectId(env);
    const pack = await getCreditPackage(env.DB, { projectId, platform: 'paypal', packageId: packId });
    if (!pack) {
      return Response.json({ success: false, error: 'Invalid pack ID' }, { status: 400 });
    }

    const invoiceId = `${projectId}-${user.sub}-${packId}-${crypto.randomUUID()}`;
    const order = await createOrder(env, pack.price, `ClearCut AI - ${pack.label}`, {
      customId: JSON.stringify({ projectId, userId: String(user.sub), packId }),
      invoiceId,
    });

    await createPendingCreditPurchaseByPackage(env.DB, {
      userId: user.sub,
      projectId,
      platform: 'paypal',
      packageId: pack.packageId,
      externalId: order.id,
    });

    return Response.json({ success: true, orderId: order.id });
  } catch (error) {
    console.error('Create PayPal order error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to create order' },
      { status: 500 },
    );
  }
}
