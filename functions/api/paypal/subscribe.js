import { getUser } from '../../lib/auth.js';
import { getSubscriptionDetails } from '../../lib/paypal.js';
import { activateSubscription, getProjectId } from '../../lib/quota.js';

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
        { status: 401 }
      );
    }

    const { subscriptionId } = await request.json();
    if (!subscriptionId) {
      return Response.json(
        { success: false, error: 'Subscription ID required' },
        { status: 400 }
      );
    }

    const subscription = await getSubscriptionDetails(env, subscriptionId);
    if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
      return Response.json(
        { success: false, error: 'Subscription not active', status: subscription.status },
        { status: 400 }
      );
    }

    const plan = getPlanFromEnv(env, subscription.plan_id);
    if (!plan) {
      return Response.json(
        { success: false, error: 'Unknown subscription plan' },
        { status: 400 }
      );
    }

    if (env.DB) {
      const projectId = getProjectId(env);

      // 防止重复订阅：已有活跃订阅时拒绝（同一 subscriptionId 重入除外）
      const existing = await env.DB.prepare(
        `SELECT subscription_external_id FROM user_quotas
         WHERE user_id = ? AND project_id = ? AND subscription_status = 'active'`
      ).bind(user.sub, projectId).first();

      if (existing && existing.subscription_external_id !== subscriptionId) {
        return Response.json(
          { success: false, error: 'Active subscription already exists', code: 'ALREADY_SUBSCRIBED' },
          { status: 409 }
        );
      }

      await activateSubscription(
        env.DB, user.sub, projectId,
        plan.planId, 'paypal', subscriptionId,
        plan.credits
      );
    }

    return Response.json({
      success: true,
      plan: plan.planId,
      credits: plan.credits,
    });

  } catch (error) {
    console.error('Subscribe error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to activate subscription' },
      { status: 500 }
    );
  }
}
