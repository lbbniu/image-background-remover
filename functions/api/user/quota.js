// 获取当前用户的配额信息
import { getUser } from '../../lib/auth.js';
import { checkQuota, getProjectId } from '../../lib/quota.js';

export async function onRequestGet(context) {
  const { request, env } = context;

  const user = await getUser(request, env);
  if (!user) {
    return Response.json({ error: 'Not authenticated' }, { status: 401 });
  }

  if (!env.DB) {
    return Response.json({ error: 'Database not configured' }, { status: 500 });
  }

  try {
    const projectId = getProjectId(env);
    const quota = await checkQuota(env.DB, user.sub, projectId);

    // 获取套餐详情
    const plan = await env.DB.prepare(
      'SELECT id, name, price_monthly, credits_monthly, features FROM subscription_plans WHERE id = ?'
    ).bind(quota.plan).first();

    return Response.json({
      plan: {
        id: plan?.id || 'free',
        name: plan?.name || 'Free',
        priceMonthly: plan?.price_monthly || 0,
        creditsMonthly: plan?.credits_monthly || 10,
        features: plan?.features ? JSON.parse(plan.features) : [],
      },
      credits: {
        remaining: quota.remaining,
        monthlyRemaining: quota.monthlyRemaining,
        bonusRemaining: quota.bonusRemaining,
        totalUsed: quota.totalUsed,
      },
    });
  } catch (err) {
    console.error('Quota query error:', err);
    return Response.json({ error: 'Failed to query quota' }, { status: 500 });
  }
}
