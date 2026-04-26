import { getUser } from '../../../../lib/auth.js';
import { getProjectId } from '../../../../lib/core/projects.js';
import { captureOrder } from '../../../../lib/paypal.js';
import { completeCreditPurchase, getCreditPurchaseByExternalId } from '../../../../lib/payments/credit-purchases.js';

export async function onRequestPost(context) {
  const { request, env, params } = context;

  try {
    const user = await getUser(request, env);
    if (!user) {
      return Response.json(
        { success: false, error: 'Login required', code: 'LOGIN_REQUIRED' },
        { status: 401 },
      );
    }

    const orderId = params.orderId;
    if (!orderId) {
      return Response.json({ success: false, error: 'Order ID required' }, { status: 400 });
    }
    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const projectId = getProjectId(env);
    const purchase = await getCreditPurchaseByExternalId(env.DB, {
      projectId,
      platform: 'paypal',
      externalId: orderId,
    });
    if (!purchase) {
      return Response.json({ success: false, error: 'Unknown order' }, { status: 404 });
    }
    if (String(purchase.userId) !== String(user.sub)) {
      return Response.json({ success: false, error: 'Order does not belong to current user' }, { status: 403 });
    }
    if (purchase.status === 'completed') {
      return Response.json({ success: true, credits: purchase.creditsAmount, label: purchase.packageName });
    }

    const captureData = await captureOrder(env, orderId);
    if (captureData.status !== 'COMPLETED') {
      return Response.json(
        { success: false, error: 'Payment not completed', status: captureData.status },
        { status: 400 },
      );
    }

    const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
    const amountPaid = capture?.amount?.value;
    const priceCents = Math.round(Number(amountPaid) * 100);
    if (!amountPaid || priceCents !== purchase.pricePaidCents) {
      console.error('Amount mismatch:', amountPaid);
      return Response.json({ success: false, error: 'Amount mismatch' }, { status: 400 });
    }

    const result = await completeCreditPurchase(env.DB, {
      projectId,
      platform: 'paypal',
      externalId: orderId,
      amountPaidCents: priceCents,
      metadata: {
        captureId: capture?.id,
        payerId: captureData.payer?.payer_id,
        confirmation: 'frontend_capture',
      },
    });
    if (!result.applied && !['already_completed'].includes(result.reason)) {
      return Response.json({ success: false, error: result.reason || 'Failed to apply credits' }, { status: 400 });
    }

    return Response.json({ success: true, credits: purchase.creditsAmount, label: purchase.packageName });
  } catch (error) {
    console.error('Capture PayPal order error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to capture order' },
      { status: 500 },
    );
  }
}
