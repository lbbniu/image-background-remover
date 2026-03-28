-- ClearCut 用户配额与订阅系统

-- 订阅套餐配置（可后台管理）
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,              -- 'free', 'starter', 'pro', 'business'
  name TEXT NOT NULL,               -- 显示名称
  price_monthly INTEGER,            -- 月付价格（美分，如 499 = $4.99）
  price_yearly INTEGER,             -- 年付价格（美分）
  credits_monthly INTEGER,          -- 每月额度
  features JSON,                    -- 功能列表 ["hd_output", "batch", "api_access"]
  stripe_price_id TEXT,             -- Stripe Price ID
  paypal_plan_id TEXT,              -- PayPal Plan ID
  is_active INTEGER DEFAULT 1,      -- 是否可购买
  created_at TEXT DEFAULT (datetime('now'))
);

-- 用户配额表
CREATE TABLE IF NOT EXISTS user_quotas (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT DEFAULT 'free' REFERENCES subscription_plans(id),
  -- 额度（每月重置）
  credits_monthly INTEGER DEFAULT 0,        -- 本月总额度
  credits_used_this_month INTEGER DEFAULT 0, -- 本月已用
  credits_reset_at TEXT,                     -- 下次重置时间
  -- 一次性额度（注册奖励、购买叠加包，用完即止）
  credits_bonus INTEGER DEFAULT 0,          -- 剩余赠送额度
  credits_bonus_total INTEGER DEFAULT 0,    -- 累计获得赠送额度（用于显示）
  -- 订阅状态
  subscription_status TEXT DEFAULT 'inactive', -- 'active', 'canceled', 'past_due'
  subscription_renew_at TEXT,                -- 订阅到期/续费时间
  payment_provider TEXT,                     -- 'stripe', 'paypal'
  payment_subscription_id TEXT,              -- 外部订阅ID
  -- 统计
  total_credits_used INTEGER DEFAULT 0,      -- 累计使用次数
  total_credits_purchased INTEGER DEFAULT 0, -- 累计购买次数
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- 使用记录（审计 + 防止重复扣费）
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  job_id TEXT UNIQUE,               -- 处理任务ID（幂等键）
  credits_used INTEGER DEFAULT 1,   -- 本次消耗额度
  source TEXT,                      -- 'monthly', 'bonus'
  status TEXT,                      -- 'success', 'failed', 'refunded'
  image_size INTEGER,               -- 原图大小（字节）
  processing_time_ms INTEGER,       -- 处理耗时
  created_at TEXT DEFAULT (datetime('now'))
);

-- 额度包购买记录（叠加包）
CREATE TABLE IF NOT EXISTS credit_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  package_name TEXT,                -- '3_credits', '50_credits'
  credits_amount INTEGER,
  price_paid_cents INTEGER,         -- 实际支付（美分）
  payment_provider TEXT,
  payment_intent_id TEXT,
  status TEXT DEFAULT 'pending',    -- 'pending', 'completed', 'refunded'
  created_at TEXT DEFAULT (datetime('now'))
);

-- 初始化默认套餐
INSERT OR IGNORE INTO subscription_plans (id, name, price_monthly, price_yearly, credits_monthly, features) VALUES
('free', 'Free', 0, 0, 10, '["standard_quality"]'),
('starter', 'Starter', 499, 4990, 100, '["hd_quality", "priority"]'),
('pro', 'Pro', 999, 9990, 300, '["hd_quality", "priority", "batch_10", "history_30d"]'),
('business', 'Business', 2999, 29990, 1000, '["hd_quality", "priority", "batch_50", "history_90d", "api_access"]');

CREATE INDEX IF NOT EXISTS idx_usage_logs_user_id ON usage_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user ON credit_purchases(user_id);
