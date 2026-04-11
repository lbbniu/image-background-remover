// 用户配额管理工具（多项目支持）

function getProjectId(env) {
  return (env && env.PROJECT_ID) || 'clearcut';
}

/**
 * 初始化新用户配额（注册时调用，送3次赠送额度）
 */
export async function initUserQuota(db, userId, projectId) {
  const now = new Date();
  const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  await db.prepare(`
    INSERT OR IGNORE INTO user_quotas 
    (user_id, project_id, plan_id, credits_gifted, period_start, period_end, credits_monthly, period_used)
    VALUES (?, ?, 'free', 3, ?, ?, 0, 0)
  `).bind(userId, projectId, periodStart, periodEnd).run();
}

/**
 * 检查并处理订阅状态（周期结束、过期等）
 */
async function checkAndUpdateSubscription(db, quota, userId, projectId) {
  const now = new Date();
  const periodEnd = quota.period_end ? new Date(quota.period_end) : null;

  // 周期未结束或无周期，直接返回
  if (!periodEnd || periodEnd > now) return quota;

  const status = quota.subscription_status;

  if (status === 'active') {
    // 活跃订阅：续订新周期
    const plan = await db.prepare(
      'SELECT credits_monthly FROM subscription_plans WHERE id = ? AND project_id = ?'
    ).bind(quota.plan_id, projectId).first();

    const monthlyCredits = plan ? plan.credits_monthly : 0;
    const nextStart = periodEnd.toISOString();
    const nextEnd = new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, periodEnd.getDate()).toISOString();

    await db.prepare(`
      UPDATE user_quotas 
      SET period_used = 0, credits_monthly = ?, period_start = ?, period_end = ?, updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(monthlyCredits, nextStart, nextEnd, userId, projectId).run();

    quota.period_used = 0;
    quota.credits_monthly = monthlyCredits;
    quota.period_start = nextStart;
    quota.period_end = nextEnd;
  } else if (status === 'cancelled') {
    // 已取消订阅且周期结束：标记过期，月度归零
    await db.prepare(`
      UPDATE user_quotas 
      SET subscription_status = 'expired', credits_monthly = 0, period_used = 0, updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ?
    `).bind(userId, projectId).run();

    quota.subscription_status = 'expired';
    quota.credits_monthly = 0;
    quota.period_used = 0;
  }

  return quota;
}

/**
 * 检查用户是否有足够额度
 */
export async function checkQuota(db, userId, projectId) {
  let quota = await db.prepare(
    'SELECT * FROM user_quotas WHERE user_id = ? AND project_id = ?'
  ).bind(userId, projectId).first();

  if (!quota) {
    await initUserQuota(db, userId, projectId);
    quota = await db.prepare(
      'SELECT * FROM user_quotas WHERE user_id = ? AND project_id = ?'
    ).bind(userId, projectId).first();
  }

  // 检查订阅状态（周期结束、过期等）
  quota = await checkAndUpdateSubscription(db, quota, userId, projectId);

  // 计算各类额度
  const monthlyRemaining = Math.max(0, (quota.credits_monthly || 0) - (quota.period_used || 0));
  const purchasedRemaining = quota.credits_purchased || 0;
  const giftedRemaining = quota.credits_gifted || 0;
  const totalRemaining = monthlyRemaining + purchasedRemaining + giftedRemaining;

  return {
    allowed: totalRemaining > 0,
    remaining: totalRemaining,
    monthlyRemaining,
    purchasedRemaining,
    giftedRemaining,
    plan: quota.plan_id,
    subscriptionStatus: quota.subscription_status,
    periodEnd: quota.period_end,
    totalUsed: quota.total_used || 0,
  };
}

/**
 * 扣减一次额度（优先级：月度订阅 > 购买积分 > 赠送积分）
 * 使用原子 UPDATE + WHERE 条件防止竞态条件，以受影响行数判断是否成功扣减。
 */
export async function deductCredit(db, userId, jobId, projectId) {
  // 先触发订阅周期检查（不依赖其 remaining 值做决策）
  const quota = await db.prepare(
    'SELECT * FROM user_quotas WHERE user_id = ? AND project_id = ?'
  ).bind(userId, projectId).first();

  if (!quota) {
    await initUserQuota(db, userId, projectId);
  } else {
    await checkAndUpdateSubscription(db, quota, userId, projectId);
  }

  let source = 'monthly';
  let result;

  // 原子扣减月度额度
  result = await db.prepare(`
    UPDATE user_quotas
    SET period_used = period_used + 1, total_used = total_used + 1, updated_at = datetime('now')
    WHERE user_id = ? AND project_id = ? AND (credits_monthly - period_used) > 0
  `).bind(userId, projectId).run();

  if (!result.meta?.changes) {
    // 月度额度不足，尝试购买积分
    source = 'purchased';
    result = await db.prepare(`
      UPDATE user_quotas
      SET credits_purchased = credits_purchased - 1, total_used = total_used + 1, updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ? AND credits_purchased > 0
    `).bind(userId, projectId).run();
  }

  if (!result.meta?.changes) {
    // 购买积分不足，尝试赠送积分
    source = 'gifted';
    result = await db.prepare(`
      UPDATE user_quotas
      SET credits_gifted = credits_gifted - 1, total_used = total_used + 1, updated_at = datetime('now')
      WHERE user_id = ? AND project_id = ? AND credits_gifted > 0
    `).bind(userId, projectId).run();
  }

  if (!result.meta?.changes) {
    return { success: false, error: 'no_credits', remaining: 0 };
  }

  // 记录使用日志
  await db.prepare(`
    INSERT INTO usage_logs (user_id, job_id, credits_used, source, status, project_id)
    VALUES (?, ?, 1, ?, 'success', ?)
  `).bind(userId, jobId, source, projectId).run();

  const updated = await checkQuota(db, userId, projectId);
  return { success: true, remaining: updated.remaining, source };
}

/**
 * 充值购买积分
 */
export async function addPurchasedCredits(db, userId, projectId, amount) {
  await db.prepare(`
    UPDATE user_quotas 
    SET credits_purchased = credits_purchased + ?, total_purchased = total_purchased + ?, updated_at = datetime('now')
    WHERE user_id = ? AND project_id = ?
  `).bind(amount, amount, userId, projectId).run();
}

/**
 * 激活订阅
 */
export async function activateSubscription(db, userId, projectId, planId, provider, externalId, monthlyCredits) {
  const now = new Date();
  const periodStart = now.toISOString();
  const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate()).toISOString();

  await db.prepare(`
    UPDATE user_quotas 
    SET plan_id = ?, subscription_status = 'active', subscription_provider = ?, subscription_external_id = ?,
        credits_monthly = ?, period_start = ?, period_end = ?, period_used = 0, updated_at = datetime('now')
    WHERE user_id = ? AND project_id = ?
  `).bind(planId, provider, externalId, monthlyCredits, periodStart, periodEnd, userId, projectId).run();
}

/**
 * 取消订阅（标记为cancelled，当前周期内仍可使用月度额度）
 */
export async function cancelSubscription(db, userId, projectId) {
  await db.prepare(`
    UPDATE user_quotas 
    SET subscription_status = 'cancelled', updated_at = datetime('now')
    WHERE user_id = ? AND project_id = ? AND subscription_status = 'active'
  `).bind(userId, projectId).run();
}

export { getProjectId };
