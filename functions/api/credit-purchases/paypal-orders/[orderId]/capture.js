import { getUser } from '../../../../lib/auth.js';
import { captureOrder } from '../../../../lib/paypal.js';
import { addPurchasedCredits, getCreditPackages, getProjectId } from '../../../../lib/quota.js';

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

    const captureData = await captureOrder(env, orderId);
    if (captureData.status !== 'COMPLETED') {
      return Response.json(
        { success: false, error: 'Payment not completed', status: captureData.status },
        { status: 400 },
      );
    }

    const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
    const amountPaid = capture?.amount?.value;
    const pack = Object.values(getCreditPackages()).find((candidate) => candidate.price === amountPaid);

    if (!pack) {
      console.error('Amount mismatch:', amountPaid);
      return Response.json({ success: false, error: 'Amount mismatch' }, { status: 400 });
    }

    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const priceCents = Math.round(parseFloat(amountPaid) * 100);
    await addPurchasedCredits(env.DB, {
      userId: user.sub,
      projectId: getProjectId(env),
      packageName: pack.label,
      credits: pack.credits,
      pricePaidCents: priceCents,
      paymentProvider: 'paypal',
      paymentIntentId: orderId,
    });

    return Response.json({ success: true, credits: pack.credits, label: pack.label });
  } catch (error) {
    console.error('Capture PayPal order error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to capture order' },
      { status: 500 },
    );
  }
}
