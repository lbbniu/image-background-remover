import { getUser } from '../../lib/auth.js';
import { createOrder } from '../../lib/paypal.js';
import { createPendingCreditPurchase, getCreditPackages, getProjectId } from '../../lib/quota.js';

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

    const { packId } = await request.json();
    const pack = getCreditPackages()[packId];
    if (!pack) {
      return Response.json({ success: false, error: 'Invalid pack ID' }, { status: 400 });
    }
    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const projectId = getProjectId(env);
    const invoiceId = `${projectId}-${user.sub}-${packId}-${crypto.randomUUID()}`;
    const order = await createOrder(env, pack.price, `ClearCut AI - ${pack.label}`, {
      customId: JSON.stringify({ projectId, userId: String(user.sub), packId }),
      invoiceId,
    });

    await createPendingCreditPurchase(env.DB, {
      userId: user.sub,
      projectId,
      packageName: pack.label,
      credits: pack.credits,
      pricePaidCents: Math.round(Number(pack.price) * 100),
      platform: 'paypal',
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
