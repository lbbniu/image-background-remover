import { getUser } from '../../foundation/modules/auth/index.js';
import { getProjectId } from '../../foundation/modules/core/index.js';
import { createCreemCheckout, createMockCheckoutSession, isCreemConfigured, isPaymentMockEnabled } from '../../foundation/integrations/index.js';
import { getPlanByPriceExternalId } from '../../foundation/modules/plans/index.js';
import { getActiveSubscription } from '../../foundation/modules/subscriptions/index.js';

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

    const { platform, priceExternalId } = await request.json();
    if (platform !== 'creem' && platform !== 'stripe') {
      return Response.json({ success: false, error: 'Unsupported subscription checkout platform' }, { status: 400 });
    }
    if (platform === 'creem' && !isCreemConfigured(env)) {
      return Response.json(
        { success: false, error: 'Creem payment is not configured' },
        { status: 503 },
      );
    }
    if (!priceExternalId) {
      return Response.json({ success: false, error: 'Plan price external ID required' }, { status: 400 });
    }

    const projectId = getProjectId(env);
    const plan = await getPlanByPriceExternalId(env.DB, { projectId, platform, externalId: priceExternalId });
    if (!plan) {
      return Response.json({ success: false, error: 'Unknown subscription plan' }, { status: 400 });
    }

    const existing = await getActiveSubscription(env.DB, { userId: user.sub, projectId });
    if (existing) {
      return Response.json(
        { success: false, error: 'Active subscription already exists', code: 'ALREADY_SUBSCRIBED' },
        { status: 409 },
      );
    }

    const successUrl = `${env.APP_URL || new URL(request.url).origin}/pricing`;
    const requestId = `${projectId}:subscription:${user.sub}:${crypto.randomUUID()}`;
    const metadata = {
      kind: 'subscription',
      projectId,
      userId: String(user.sub),
      planId: plan.planId,
      priceExternalId,
      platform,
    };

    let session;
    if (platform === 'creem') {
      session = await createCreemCheckout(env, {
        productId: priceExternalId,
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
        kind: 'subscription',
        amountCents: plan.amountCents,
        currency: plan.currency,
        description: `${plan.name} subscription`,
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

    return Response.json({
      success: true,
      platform,
      sessionId,
      checkoutUrl: session.checkout_url || session.checkoutUrl || session.url,
      mock: platform !== 'creem',
    }, { status: 201 });
  } catch (error) {
    console.error('Create subscription checkout session error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to create subscription checkout session' },
      { status: 500 },
    );
  }
}
