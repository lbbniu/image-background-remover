import { getUser } from '../../../foundation/modules/auth/index.js';
import { getProjectId } from '../../../foundation/modules/core/index.js';
import { createPendingCreditPurchase, getCreditPackage } from '../../../foundation/modules/payments/index.js';
import {
  createCreemCheckout,
  createMockCheckoutSession,
  isCreemConfigured,
  isMockPaymentPlatform,
  isPaymentMockEnabled,
} from '../../../foundation/integrations/index.js';

export async function onRequestPost({ request, env }) {
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

    const { platform, packId } = await request.json();
    if (platform !== 'creem' && !isMockPaymentPlatform(platform)) {
      return Response.json(
        { success: false, error: 'Unsupported checkout platform' },
        { status: 400 },
      );
    }
    if (platform !== 'creem' && !isPaymentMockEnabled(env)) {
      return Response.json(
        { success: false, error: `${platform} mock payment is disabled` },
        { status: 503 },
      );
    }

    const projectId = getProjectId(env);
    const pack = await getCreditPackage(env.DB, { projectId, platform, packageId: packId });
    if (!pack) {
      return Response.json({ success: false, error: 'Invalid pack ID' }, { status: 400 });
    }

    const successUrl = `${env.APP_URL || new URL(request.url).origin}/pricing`;
    const requestId = `${projectId}:credit:${user.sub}:${crypto.randomUUID()}`;
    const metadata = {
      kind: 'credit_purchase',
      projectId,
      userId: String(user.sub),
      packId,
      platform,
    };

    let session;
    if (platform === 'creem' && isCreemConfigured(env)) {
      if (!pack.externalId) {
        return Response.json({ success: false, error: 'Creem product ID not configured' }, { status: 400 });
      }
      session = await createCreemCheckout(env, {
        productId: pack.externalId,
        requestId,
        successUrl,
        customer: user.email ? { email: user.email } : undefined,
        metadata,
      });
    } else {
      if (!isPaymentMockEnabled(env)) {
        return Response.json(
          { success: false, error: `${platform} payment is not configured` },
          { status: 503 },
        );
      }
      session = createMockCheckoutSession(env, {
        platform,
        kind: 'credit_purchase',
        amountCents: pack.amountCents,
        currency: pack.currency,
        description: `${pack.label}`,
        successUrl,
        cancelUrl: successUrl,
        metadata: {
          ...metadata,
          requestId,
        },
      });
    }

    const sessionId = session.id;
    if (!sessionId) {
      return Response.json({ success: false, error: 'Checkout session ID missing' }, { status: 502 });
    }

    await createPendingCreditPurchase(env.DB, {
      userId: user.sub,
      projectId,
      packageName: pack.label,
      credits: pack.credits,
      pricePaidCents: pack.amountCents,
      platform,
      externalId: sessionId,
    });

    return Response.json({
      success: true,
      platform,
      sessionId,
      checkoutUrl: session.checkout_url || session.checkoutUrl || session.url,
      mock: !(platform === 'creem' && isCreemConfigured(env)),
    }, { status: 201 });
  } catch (error) {
    console.error('Create checkout session error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to create checkout session' },
      { status: 500 },
    );
  }
}
