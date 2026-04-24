import { getUser } from '../lib/auth.js';
import { getSubscriptionDetails } from '../lib/paypal.js';
import { activateUserSubscription, getActiveSubscription, getProjectId } from '../lib/quota.js';

function getPlanFromEnv(env, subscriptionPlanId) {
  if (subscriptionPlanId === env.PAYPAL_PLAN_PRO_MONTHLY ||
      subscriptionPlanId === env.PAYPAL_PLAN_PRO_YEARLY) {
    return { planId: 'pro', credits: 300 };
  }
  if (subscriptionPlanId === env.PAYPAL_PLAN_BIZ_MONTHLY ||
      subscriptionPlanId === env.PAYPAL_PLAN_BIZ_YEARLY) {
    return { planId: 'business', credits: 1000 };
  }
  return null;
}

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

    const { provider, externalId } = await request.json();
    if (provider !== 'paypal') {
      return Response.json({ success: false, error: 'Unsupported subscription provider' }, { status: 400 });
    }
    if (!externalId) {
      return Response.json({ success: false, error: 'Subscription external ID required' }, { status: 400 });
    }

    const subscription = await getSubscriptionDetails(env, externalId);
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
      return Response.json(
        { success: false, error: 'Subscription not active', status: subscription.status },
        { status: 400 },
      );
    }

    const plan = getPlanFromEnv(env, subscription.plan_id);
    if (!plan) {
      return Response.json({ success: false, error: 'Unknown subscription plan' }, { status: 400 });
    }

    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const projectId = getProjectId(env);
    const existing = await getActiveSubscription(env.DB, { userId: user.sub, projectId });
    if (existing && existing.subscriptionExternalId !== externalId) {
      return Response.json(
        { success: false, error: 'Active subscription already exists', code: 'ALREADY_SUBSCRIBED' },
        { status: 409 },
      );
    }

    await activateUserSubscription(env.DB, {
      userId: user.sub,
      projectId,
      planId: plan.planId,
      subscriptionProvider: provider,
      subscriptionExternalId: externalId,
      monthlyCredits: plan.credits,
    });

    return Response.json({ success: true, plan: plan.planId, credits: plan.credits }, { status: 201 });
  } catch (error) {
    console.error('Create subscription error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to activate subscription' },
      { status: 500 },
    );
  }
}
