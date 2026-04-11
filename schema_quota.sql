-- ClearCut 用户配额与订阅系统（以代码为准，2026-04-11 校正）

-- 订阅套餐配置（可后台管理）
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  name TEXT NOT NULL,
  price_monthly INTEGER,            -- 月付价格（美分，如 499 = $4.99）
  price_yearly INTEGER,             -- 年付价格（美分）
  credits_monthly INTEGER,          -- 每月额度
  features JSON,                    -- 功能列表 ["hd_output", "batch", "api_access"]
  stripe_price_id TEXT,
  paypal_plan_id TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (id, project_id)
);

-- 用户配额表（核心表）
CREATE TABLE IF NOT EXISTS user_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  plan_id TEXT DEFAULT 'free',
  -- 月度订阅额度
  credits_monthly INTEGER DEFAULT 0,  -- 当前周期总月度额度
  period_used INTEGER DEFAULT 0,      -- 当前周期已用月度额度
  period_start TEXT,                  -- 当前计费周期开始时间
  period_end TEXT,                    -- 当前计费周期结束时间（到期/续费节点）
  -- 一次性额度
  credits_purchased INTEGER DEFAULT 0, -- 剩余购买积分（充值叠加包）
  credits_gifted INTEGER DEFAULT 0,    -- 剩余赠送积分（注册奖励等）
  -- 订阅状态
  subscription_status TEXT DEFAULT 'inactive', -- 'active', 'cancelled', 'expired', 'past_due', 'inactive'
  subscription_provider TEXT,          -- 'paypal', 'stripe'
  subscription_external_id TEXT,       -- PayPal/Stripe 订阅 ID
  -- 统计（只增不减）
  total_used INTEGER DEFAULT 0,        -- 累计使用次数
  total_purchased INTEGER DEFAULT 0,   -- 累计购买积分数
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id)
);

-- 使用记录（审计 + 幂等防重）
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  job_id TEXT UNIQUE,               -- 处理任务 ID（幂等键）
  credits_used INTEGER DEFAULT 1,
  source TEXT,                      -- 'monthly', 'purchased', 'gifted'
  status TEXT,                      -- 'success', 'failed', 'refunded'
  image_size INTEGER,               -- 原图大小（字节）
  processing_time_ms INTEGER,       -- 处理耗时
  created_at TEXT DEFAULT (datetime('now'))
);

-- 额度包购买记录
CREATE TABLE IF NOT EXISTS credit_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  package_name TEXT,                -- '50 Credits', '200 Credits', '500 Credits'
  credits_amount INTEGER,
  price_paid_cents INTEGER,         -- 实际支付（美分）
  payment_provider TEXT,            -- 'paypal', 'stripe'
  payment_intent_id TEXT,           -- PayPal Order ID / Stripe Payment Intent ID
  status TEXT DEFAULT 'pending',    -- 'pending', 'completed', 'refunded'
  created_at TEXT DEFAULT (datetime('now'))
);

-- 初始化默认套餐（每个 project 各一份）
INSERT OR IGNORE INTO subscription_plans (id, project_id, name, price_monthly, price_yearly, credits_monthly, features) VALUES
('free',     'clearcut', 'Free',     0,    0,     10,  '["standard_quality"]'),
('starter',  'clearcut', 'Starter',  499,  4990,  100, '["hd_quality", "priority"]'),
('pro',      'clearcut', 'Pro',      999,  9990,  300, '["hd_quality", "priority", "batch_10", "history_30d"]'),
('business', 'clearcut', 'Business', 2999, 29990, 1000,'["hd_quality", "priority", "batch_50", "history_90d", "api_access"]');

-- 索引
CREATE INDEX IF NOT EXISTS idx_user_quotas_user_project ON user_quotas(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_user_quotas_ext_id ON user_quotas(subscription_external_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_project ON usage_logs(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user ON credit_purchases(user_id, project_id);
