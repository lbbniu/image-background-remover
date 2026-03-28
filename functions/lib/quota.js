// 用户配额管理工具

/**
 * 初始化新用户配额（注册时调用，送3次额度）
 */
export async function initUserQuota(db, userId) {
  const now = new Date();
  const resetAt = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();

  await db.prepare(`
    INSERT OR IGNORE INTO user_quotas (user_id, plan_id, credits_monthly, credits_used_this_month, credits_reset_at, credits_bonus, credits_bonus_total)
    VALUES (?, 'free', 10, 0, ?, 3, 3)
  `).bind(userId, resetAt).run();
}

/**
 * 检查用户是否有足够额度（返回 { allowed, remaining, source } ）
 */
export async function checkQuota(db, userId) {
  let quota = await db.prepare('SELECT * FROM user_quotas WHERE user_id = ?').bind(userId).first();

  if (!quota) {
    await initUserQuota(db, userId);
    quota = await db.prepare('SELECT * FROM user_quotas WHERE user_id = ?').bind(userId).first();
  }

  // 检查是否需要重置月度额度
  const now = new Date();
  if (quota.credits_reset_at && new Date(quota.credits_reset_at) <= now) {
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    // 获取套餐的月度额度
    const plan = await db.prepare('SELECT credits_monthly FROM subscription_plans WHERE id = ?').bind(quota.plan_id).first();
    const monthlyCredits = plan ? plan.credits_monthly : 10;

    await db.prepare(`
      UPDATE user_quotas SET credits_used_this_month = 0, credits_monthly = ?, credits_reset_at = ?, updated_at = datetime('now')
      WHERE user_id = ?
    `).bind(monthlyCredits, nextReset, userId).run();

    quota.credits_used_this_month = 0;
    quota.credits_monthly = monthlyCredits;
  }

  const monthlyRemaining = Math.max(0, quota.credits_monthly - quota.credits_used_this_month);
  const bonusRemaining = quota.credits_bonus || 0;
  const totalRemaining = monthlyRemaining + bonusRemaining;

  return {
    allowed: totalRemaining > 0,
    remaining: totalRemaining,
    monthlyRemaining,
    bonusRemaining,
    plan: quota.plan_id,
    totalUsed: quota.total_credits_used || 0,
  };
}

/**
 * 扣减一次额度（优先扣月度，再扣赠送）
 */
export async function deductCredit(db, userId, jobId) {
  const quotaCheck = await checkQuota(db, userId);
  if (!quotaCheck.allowed) {
    return { success: false, error: 'no_credits', remaining: 0 };
  }

  let source = 'monthly';
  if (quotaCheck.monthlyRemaining > 0) {
    await db.prepare(`
      UPDATE user_quotas SET credits_used_this_month = credits_used_this_month + 1, total_credits_used = total_credits_used + 1, updated_at = datetime('now')
      WHERE user_id = ?
    `).bind(userId).run();
  } else {
    source = 'bonus';
    await db.prepare(`
      UPDATE user_quotas SET credits_bonus = credits_bonus - 1, total_credits_used = total_credits_used + 1, updated_at = datetime('now')
      WHERE user_id = ?
    `).bind(userId).run();
  }

  // 记录使用日志
  await db.prepare(`
    INSERT INTO usage_logs (user_id, job_id, credits_used, source, status) VALUES (?, ?, 1, ?, 'success')
  `).bind(userId, jobId, source).run();

  const updated = await checkQuota(db, userId);
  return { success: true, remaining: updated.remaining, source };
}
