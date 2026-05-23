import { getUser } from '../../../foundation/modules/auth/index.js';
import { getProjectId } from '../../../foundation/modules/core/index.js';
import { createPendingCreditPurchaseByPackage, getCreditPackage } from '../../../foundation/modules/payments/index.js';
import { createPay } from '../../../foundation/integrations/pay/index.js';
import { createMockCheckoutSession, isMockPaymentPlatform, isPaymentMockEnabled } from '../../../foundation/integrations/index.js';

const SUPPORTED_PROVIDERS = ['creem', 'paypal', 'stripe'];

export async function onRequestPost({ request, env, params }) {
  const provider = params.provider?.toLowerCase();

  if (!SUPPORTED_PROVIDERS.includes(provider) && !isMockPaymentPlatform(provider)) {
    return Response.json({ success: false, error: `Unsupported provider: ${provider}` }, { status: 400 });
  }

  try {
    const user = await getUser(request, env);
    if (!user) {
      return Response.json({ success: false, error: 'Login required', code: 'LOGIN_REQUIRED' }, { status: 401 });
    }
    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const { packId } = await request.json();
    const projectId = getProjectId(env);
    const pack = await getCreditPackage(env.DB, { projectId, platform: provider, packageId: packId });
    if (!pack) {
      return Response.json({ success: false, error: 'Invalid pack ID' }, { status: 400 });
    }
    if (!pack.externalId) {
      return Response.json({ success: false, error: `${provider} product ID not configured for this pack` }, { status: 400 });
    }

    const successUrl = `${env.APP_URL || new URL(request.url).origin}/pricing`;
    const metadata = { kind: 'credit_purchase', projectId, userId: String(user.sub), packId, platform: provider };

    // Mock providers bypass real payment
    if (isMockPaymentPlatform(provider)) {
      if (!isPaymentMockEnabled(env)) {
        return Response.json({ success: false, error: `${provider} mock payment is disabled` }, { status: 503 });
      }
      const session = createMockCheckoutSession(env, {
        platform: provider, kind: 'credit_purchase',
        amountCents: pack.amountCents, currency: pack.currency,
        description: pack.label, successUrl, cancelUrl: successUrl,
        metadata: { ...metadata, requestId: crypto.randomUUID() },
      });
      await createPendingCreditPurchaseByPackage(env.DB, {
        userId: user.sub, projectId, platform: provider, packageId: pack.packageId, externalId: session.id,
      });
      return Response.json({ success: true, provider, sessionId: session.id, checkoutUrl: session.url, mock: true }, { status: 201 });
    }

    // Real payment via createPay
    const providerEnv = { ...env, PAYMENT_PROVIDER: provider };
    const pay = createPay(providerEnv);

    let result;
    if (provider === 'paypal') {
      // PayPal uses charge() → returns orderId, client captures on frontend
      result = await pay.charge({
        amount: pack.amountCents / 100,
        currency: pack.currency || 'USD',
        email: user.email,
        successUrl,
        cancelUrl: successUrl,
        metadata,
      });
    } else {
      // Creem / Stripe use checkout() → returns redirect URL
      result = await pay.checkout({
        plan: pack.externalId,
        currency: pack.currency || 'USD',
        email: user.email,
        successUrl,
        cancelUrl: successUrl,
      });
    }

    await createPendingCreditPurchaseByPackage(env.DB, {
      userId: user.sub, projectId, platform: provider, packageId: pack.packageId, externalId: result.id,
    });

    return Response.json({
      success: true, provider,
      sessionId: result.id,
      checkoutUrl: result.url,
      // PayPal needs extra capture step
      ...(provider === 'paypal' ? { orderId: result.id, requiresCapture: true } : {}),
    }, { status: 201 });
  } catch (error) {
    console.error(`[checkout/${provider}] error:`, error);
    return Response.json({ success: false, error: error.message || 'Failed to create checkout' }, { status: 500 });
  }
}
