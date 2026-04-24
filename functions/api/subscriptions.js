import { getUser } from '../lib/auth.js';
import { getSubscriptionDetails } from '../lib/paypal.js';
import { activateUserSubscription, getActiveSubscription, getPlanByPriceExternalId, getProjectId } from '../lib/quota.js';

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

    const { platform, externalId } = await request.json();
    if (platform !== 'paypal') {
      return Response.json({ success: false, error: 'Unsupported subscription platform' }, { status: 400 });
    }
    if (!externalId) {
      return Response.json({ success: false, error: 'Subscription external ID required' }, { status: 400 });
    }

    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const projectId = getProjectId(env);
    const subscription = await getSubscriptionDetails(env, externalId);
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
      return Response.json(
        { success: false, error: 'Subscription not active', status: subscription.status },
        { status: 400 },
      );
    }

    const plan = await getPlanByPriceExternalId(env.DB, {
      projectId,
      platform,
      externalId: subscription.plan_id,
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

    return Response.json({ success: true, plan: plan.planId, credits: plan.creditsMonthly }, { status: 201 });
  } catch (error) {
    console.error('Create subscription error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to activate subscription' },
      { status: 500 },
    );
  }
}
