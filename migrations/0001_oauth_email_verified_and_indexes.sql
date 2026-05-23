-- 增加 OAuth 邮箱验证标记，并补充多项目场景的复合索引
ALTER TABLE oauth_accounts ADD COLUMN email_verified INTEGER DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_usage_logs_project_job
  ON usage_logs(project_id, job_id);

CREATE INDEX IF NOT EXISTS idx_credit_purchases_project_platform
  ON credit_purchases(project_id, platform, external_id);

CREATE INDEX IF NOT EXISTS idx_payment_events_project_platform
  ON payment_events(project_id, platform, external_id);

-- 在创建唯一索引前先把同一 (user_id, project_id) 多条 active 订阅收敛为一条：
-- 保留 id 最大的（最新激活的）那一条，其余置为 expired，否则 CREATE UNIQUE INDEX 会报错。
UPDATE subscriptions
SET status = 'expired', updated_at = datetime('now')
WHERE status = 'active'
  AND id NOT IN (
    SELECT MAX(id) FROM subscriptions
    WHERE status = 'active'
    GROUP BY user_id, project_id
  );

-- 仅允许同一 (user_id, project_id) 一条 active 订阅
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_active_per_user
  ON subscriptions(user_id, project_id) WHERE status = 'active';
