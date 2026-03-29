-- ClearCut DB Migration: Add project_id for multi-project support
-- Current project: 'clearcut'

-- 1. Rebuild user_quotas with project_id (SQLite can't ALTER PRIMARY KEY)
CREATE TABLE user_quotas_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  plan_id TEXT DEFAULT 'free',
  credits_monthly INTEGER DEFAULT 0,
  credits_used_this_month INTEGER DEFAULT 0,
  credits_reset_at TEXT,
  credits_bonus INTEGER DEFAULT 0,
  credits_bonus_total INTEGER DEFAULT 0,
  subscription_status TEXT DEFAULT 'inactive',
  subscription_renew_at TEXT,
  payment_provider TEXT,
  payment_subscription_id TEXT,
  total_credits_used INTEGER DEFAULT 0,
  total_credits_purchased INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id)
);

INSERT INTO user_quotas_new (user_id, project_id, plan_id, credits_monthly, credits_used_this_month, credits_reset_at, credits_bonus, credits_bonus_total, subscription_status, subscription_renew_at, payment_provider, payment_subscription_id, total_credits_used, total_credits_purchased, created_at, updated_at)
SELECT user_id, 'clearcut', plan_id, credits_monthly, credits_used_this_month, credits_reset_at, credits_bonus, credits_bonus_total, subscription_status, subscription_renew_at, payment_provider, payment_subscription_id, total_credits_used, total_credits_purchased, created_at, updated_at
FROM user_quotas;

DROP TABLE user_quotas;
ALTER TABLE user_quotas_new RENAME TO user_quotas;

-- 2. Add project_id to other tables
ALTER TABLE credit_purchases ADD COLUMN project_id TEXT DEFAULT 'clearcut';
ALTER TABLE usage_logs ADD COLUMN project_id TEXT DEFAULT 'clearcut';
ALTER TABLE subscription_plans ADD COLUMN project_id TEXT DEFAULT 'clearcut';
