import { getUser } from '../../lib/auth.js';
import { getPlan, getProjectId, getUserCreditBalance } from '../../lib/quota.js';

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
    const quota = await getUserCreditBalance(env.DB, { userId: user.sub, projectId });
    const plan = await getPlan(env.DB, { planId: quota.plan, projectId });

    return Response.json({
      plan: {
        id: plan?.id || 'free',
        name: plan?.name || 'Free',
        priceMonthly: plan?.priceMonthly || 0,
        creditsMonthly: plan?.creditsMonthly || 10,
        features: plan?.features ? JSON.parse(plan.features) : [],
      },
      credits: {
        remaining: quota.remaining,
        monthlyRemaining: quota.monthlyRemaining,
        purchasedRemaining: quota.purchasedRemaining,
        giftedRemaining: quota.giftedRemaining,
        totalUsed: quota.totalUsed,
      },
    });
  } catch (err) {
    console.error('Credits query error:', err);
    return Response.json({ error: 'Failed to query credits' }, { status: 500 });
  }
}
