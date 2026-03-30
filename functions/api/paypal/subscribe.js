import { getUser } from '../../lib/auth.js';
import { getSubscriptionDetails } from '../../lib/paypal.js';

// 订阅计划到内部 plan_id 的映射
const PLAN_MAPPING = {
  // 这些值会在 init-paypal-plans.js 创建后填入
  // 格式: 'PAYPAL_PLAN_ID': { planId: 'pro'|'business', credits: 200|1000 }
};

function getPlanFromEnv(env, subscriptionPlanId) {
  // 从环境变量中匹配 plan
  if (subscriptionPlanId === env.PAYPAL_PLAN_PRO_MONTHLY ||
      subscriptionPlanId === env.PAYPAL_PLAN_PRO_YEARLY) {
    return { planId: 'pro', credits: 200 };
  }
  if (subscriptionPlanId === env.PAYPAL_PLAN_BIZ_MONTHLY ||
      subscriptionPlanId === env.PAYPAL_PLAN_BIZ_YEARLY) {
    return { planId: 'business', credits: 1000 };
  }
  return PLAN_MAPPING[subscriptionPlanId] || null;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 1. 验证登录
    const user = await getUser(request, env);
    if (!user) {
      return Response.json(
        { success: false, error: 'Login required', code: 'LOGIN_REQUIRED' },
        { status: 401 }
      );
    }

    // 2. 解析请求
    const { subscriptionId } = await request.json();
    if (!subscriptionId) {
      return Response.json(
        { success: false, error: 'Subscription ID required' },
        { status: 400 }
      );
    }

    // 3. 验证订阅状态
    const subscription = await getSubscriptionDetails(env, subscriptionId);

    if (subscription.status !== 'ACTIVE' && subscription.status !== 'APPROVED') {
      return Response.json(
        { success: false, error: 'Subscription not active', status: subscription.status },
        { status: 400 }
      );
    }

    // 4. 匹配内部套餐
    const plan = getPlanFromEnv(env, subscription.plan_id);
    if (!plan) {
      return Response.json(
        { success: false, error: 'Unknown subscription plan' },
        { status: 400 }
      );
    }

    // 5. 更新用户套餐
    if (env.DB) {
      const now = new Date();
      const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
      const projectId = env.PROJECT_ID || 'clearcut';

      await env.DB.prepare(`
        UPDATE user_quotas 
        SET plan_id = ?, 
            credits_monthly = ?, 
            credits_used_this_month = 0, 
            credits_reset_at = ?,
            subscription_status = 'active',
            subscription_provider = 'paypal',
            subscription_external_id = ?,
            updated_at = datetime('now')
        WHERE user_id = ? AND project_id = ?
      `).bind(plan.planId, plan.credits, resetAt, subscriptionId, user.sub, projectId).run();
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
