import { getUser } from '../../foundation/modules/auth/index.js';
import { getProjectId } from '../../foundation/modules/core/index.js';
import {
  assertMockPaymentEnabled,
  getSubscriptionDetails,
  isMockPaymentPlatform,
  isPaymentMockEnabled,
} from '../../foundation/integrations/index.js';
import { getPlanByPriceExternalId } from '../../foundation/modules/plans/index.js';
import { activateUserSubscription, getActiveSubscription } from '../../foundation/modules/subscriptions/index.js';

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

    const { platform, externalId, priceExternalId } = await request.json();
    if (platform !== 'paypal' && !isMockPaymentPlatform(platform)) {
      return Response.json({ success: false, error: 'Unsupported subscription platform' }, { status: 400 });
    }
    if (!externalId) {
      return Response.json({ success: false, error: 'Subscription external ID required' }, { status: 400 });
    }

    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const projectId = getProjectId(env);
    let planPriceExternalId = priceExternalId;
    let subscriptionStatus = 'MOCK_ACTIVE';

    if (platform === 'paypal') {
      const subscription = await getSubscriptionDetails(env, externalId);
      subscriptionStatus = subscription.status;
      if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
        return Response.json(
          { success: false, error: 'Subscription not active', status: subscription.status },
          { status: 400 },
        );
      }
      planPriceExternalId = subscription.plan_id;
    } else {
      if (!isPaymentMockEnabled(env)) {
        return Response.json(
          { success: false, error: `${platform} mock payment is disabled` },
          { status: 503 },
        );
      }
      assertMockPaymentEnabled(env, platform);
      if (!planPriceExternalId) {
        return Response.json({ success: false, error: 'Plan price external ID required' }, { status: 400 });
      }
    }

    const plan = await getPlanByPriceExternalId(env.DB, {
      projectId,
      platform,
      externalId: planPriceExternalId,
    });
    if (!plan) {
      return Response.json({ success: false, error: 'Unknown subscription plan' }, { status: 400 });
    }

    const existing = await getActiveSubscription(env.DB, { userId: user.sub, projectId });
    if (existing && existing.externalId !== externalId) {
      return Response.json(
        { success: false, error: 'Active subscription already exists', code: 'ALREADY_SUBSCRIBED' },
        { status: 409 },
      );
    }

    await activateUserSubscription(env.DB, {
      userId: user.sub,
      projectId,
      planId: plan.planId,
      platform,
      externalId,
      monthlyCredits: plan.creditsMonthly,
    });

    return Response.json({
      success: true,
      plan: plan.planId,
      credits: plan.creditsMonthly,
      platform,
      status: subscriptionStatus,
      mock: platform !== 'paypal',
    }, { status: 201 });
  } catch (error) {
    console.error('Create subscription error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to activate subscription' },
      { status: 500 },
    );
  }
}
