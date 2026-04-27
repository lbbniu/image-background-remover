-- ClearCut D1 数据库表结构（账号 / OAuth / 订阅 / 积分）
-- 创建方式: wrangler d1 execute clearcut-db --file=schema.sql --remote

-- 用户主表（平台无关）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  name TEXT,
  avatar TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_login TEXT NOT NULL DEFAULT (datetime('now'))
);

-- OAuth 关联表（支持 Google / GitHub / 微信等多平台）
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,          -- 'google', 'github', 'wechat' ...
  external_id TEXT NOT NULL,       -- 第三方平台账号唯一 ID
  email TEXT,
  name TEXT,
  avatar TEXT,
  access_token TEXT,
  refresh_token TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_oauth_user_id ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_platform ON oauth_accounts(platform, external_id);

-- 订阅套餐配置（可后台管理）
CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  name TEXT NOT NULL,
  price_monthly INTEGER,            -- 月付价格（美分，如 499 = $4.99）
  price_yearly INTEGER,             -- 年付价格（美分）
  credits_monthly INTEGER,          -- 每月额度
  features JSON,                    -- 功能列表 ["hd_output", "batch", "api_access"]
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, project_id)
);

-- 套餐价格映射（支持 PayPal / Stripe / Creem 等多支付平台）
CREATE TABLE IF NOT EXISTS plan_prices (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  plan_id TEXT NOT NULL,
  platform TEXT NOT NULL,            -- 'paypal', 'stripe', 'creem'
  external_id TEXT NOT NULL,         -- 支付平台 price/plan/product ID
  interval TEXT NOT NULL,            -- 'month', 'year', 'one_time'
  currency TEXT NOT NULL DEFAULT 'USD',
  amount_cents INTEGER NOT NULL,
  is_active INTEGER DEFAULT 1,
  metadata JSON,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, project_id),
  UNIQUE(platform, external_id)
);

-- 接口计费规则（action + variant -> 应扣站内积分）
CREATE TABLE IF NOT EXISTS usage_pricing (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  action TEXT NOT NULL,               -- 'background.remove', 'image.upscale'
  variant TEXT NOT NULL DEFAULT 'default', -- 'photoroom', 'bria', 'removebg', 'default'
  credits INTEGER NOT NULL,           -- 本次调用扣减的站内积分
  cost_estimate_cents INTEGER DEFAULT 0, -- 内部成本估算（美分），仅用于分析
  metadata JSON,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, project_id),
  UNIQUE(project_id, action, variant)
);

-- 积分包配置（支持 PayPal / Stripe / Creem 等多支付平台）
CREATE TABLE IF NOT EXISTS credit_packages (
  id TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  package_id TEXT NOT NULL,          -- 前端传入的积分包 ID，如 '50', '200'
  name TEXT NOT NULL,                -- 展示名，如 '50 Credits'
  credits INTEGER NOT NULL,          -- 购买后增加的积分数
  platform TEXT NOT NULL,            -- 'paypal', 'stripe', 'creem'
  external_id TEXT,                  -- 支付平台 product/price/sku ID，可为空
  currency TEXT NOT NULL DEFAULT 'USD',
  amount_cents INTEGER NOT NULL,     -- 售价（美分）
  badge TEXT,                        -- 展示角标，如 'best'
  sort_order INTEGER DEFAULT 0,
  metadata JSON,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (id, project_id),
  UNIQUE(project_id, platform, package_id)
);

-- 用户配额表（核心表）
CREATE TABLE IF NOT EXISTS user_quotas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  plan_id TEXT DEFAULT 'free',
  credits_monthly INTEGER DEFAULT 0,   -- 当前周期总月度额度
  period_used INTEGER DEFAULT 0,       -- 当前周期已用月度额度
  period_start TEXT,                   -- 当前计费周期开始时间
  period_end TEXT,                     -- 当前计费周期结束时间（到期/续费节点）
  credits_purchased INTEGER DEFAULT 0, -- 剩余购买积分（充值叠加包）
  credits_gifted INTEGER DEFAULT 0,    -- 剩余赠送积分（注册奖励等）
  total_used INTEGER DEFAULT 0,        -- 累计使用次数
  total_purchased INTEGER DEFAULT 0,   -- 累计购买积分数
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, project_id)
);

-- 订阅记录（独立于额度快照，便于多支付平台和审计）
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  plan_id TEXT NOT NULL,
  platform TEXT NOT NULL,              -- 'paypal', 'stripe'
  external_id TEXT NOT NULL,           -- PayPal/Stripe 订阅 ID
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'cancelled', 'expired', 'past_due'
  current_period_start TEXT,
  current_period_end TEXT,
  cancel_at_period_end INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(platform, external_id)
);

-- 使用记录（审计 + 幂等防重）
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  job_id TEXT UNIQUE,                -- 处理任务 ID（幂等键）
  credits_used INTEGER DEFAULT 1,
  source TEXT,                       -- 'monthly', 'purchased', 'gifted'
  status TEXT,                       -- 'success', 'failed', 'refunded'
  metadata JSON,                     -- 业务侧扩展数据
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 额度包购买记录
CREATE TABLE IF NOT EXISTS credit_purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  package_name TEXT,                 -- '50 Credits', '200 Credits', '500 Credits'
  credits_amount INTEGER,
  price_paid_cents INTEGER,          -- 实际支付（美分）
  platform TEXT,                     -- 'paypal', 'stripe'
  external_id TEXT,                  -- PayPal Order ID / Stripe Payment Intent ID
  status TEXT DEFAULT 'pending',     -- 'pending', 'completed', 'refunded'
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 支付平台事件记录（webhook 幂等 + 审计）
CREATE TABLE IF NOT EXISTS payment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  platform TEXT NOT NULL,            -- 'paypal', 'stripe', 'creem'
  external_id TEXT NOT NULL,         -- webhook event id / order id / transaction id
  event_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  status TEXT DEFAULT 'received',    -- 'received', 'processed', 'ignored', 'failed'
  payload JSON,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  UNIQUE(platform, external_id)
);

-- 积分流水账本（所有额度变化必须写流水）
CREATE TABLE IF NOT EXISTS credit_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL DEFAULT 'clearcut',
  type TEXT NOT NULL,                -- 'gift', 'purchase', 'subscription', 'consume', 'refund', 'adjustment'
  source TEXT,                       -- 'monthly', 'purchased', 'gifted'
  amount INTEGER NOT NULL,           -- 正数增加额度，负数消耗额度
  platform TEXT,                     -- 外部来源平台，可为空
  external_id TEXT,                  -- 外部幂等 ID / job ID / payment ID
  metadata JSON,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 初始化默认套餐（每个 project 各一份）
INSERT OR IGNORE INTO subscription_plans (id, project_id, name, price_monthly, price_yearly, credits_monthly, features) VALUES
('free',     'clearcut', 'Free',     0,    0,     10,  '["standard_quality"]'),
('starter',  'clearcut', 'Starter',  499,  4990,  100, '["hd_quality", "priority"]'),
('pro',      'clearcut', 'Pro',      999,  9990,  300, '["hd_quality", "priority", "batch_10", "history_30d"]'),
('business', 'clearcut', 'Business', 2999, 29990, 1000,'["hd_quality", "priority", "batch_50", "history_90d", "api_access"]');

-- PayPal sandbox 默认价格映射（生产环境可替换为对应平台 ID）
INSERT OR IGNORE INTO plan_prices (id, project_id, plan_id, platform, external_id, interval, currency, amount_cents) VALUES
('paypal_pro_monthly',      'clearcut', 'pro',      'paypal', 'P-71M61162GE011714JNHEV2SI', 'month', 'USD', 999),
('paypal_pro_yearly',       'clearcut', 'pro',      'paypal', 'P-4YK949015E500590JNHEV2SI', 'year',  'USD', 9990),
('paypal_business_monthly', 'clearcut', 'business', 'paypal', 'P-8P429838BA503293TNHEV2SQ', 'month', 'USD', 2999),
('paypal_business_yearly',  'clearcut', 'business', 'paypal', 'P-4W476401A4943870XNHEV2SQ', 'year',  'USD', 29990);

-- Stripe mock / Creem 默认价格映射（真实接入时替换 external_id）
INSERT OR IGNORE INTO plan_prices (id, project_id, plan_id, platform, external_id, interval, currency, amount_cents) VALUES
('stripe_pro_monthly',      'clearcut', 'pro',      'stripe', 'price_mock_pro_monthly',      'month', 'USD', 999),
('stripe_pro_yearly',       'clearcut', 'pro',      'stripe', 'price_mock_pro_yearly',       'year',  'USD', 9990),
('stripe_business_monthly', 'clearcut', 'business', 'stripe', 'price_mock_business_monthly', 'month', 'USD', 2999),
('stripe_business_yearly',  'clearcut', 'business', 'stripe', 'price_mock_business_yearly',  'year',  'USD', 29990),
('creem_pro_monthly',       'clearcut', 'pro',      'creem',  'creem_mock_pro_monthly',      'month', 'USD', 999),
('creem_pro_yearly',        'clearcut', 'pro',      'creem',  'creem_mock_pro_yearly',       'year',  'USD', 9990),
('creem_business_monthly',  'clearcut', 'business', 'creem',  'creem_mock_business_monthly', 'month', 'USD', 2999),
('creem_business_yearly',   'clearcut', 'business', 'creem',  'creem_mock_business_yearly',  'year',  'USD', 29990);

-- 默认接口计费规则（可按 project_id 独立配置）
INSERT OR IGNORE INTO usage_pricing (id, project_id, action, variant, credits, cost_estimate_cents, metadata) VALUES
('background_remove_photoroom', 'clearcut', 'background.remove', 'photoroom', 2, 2,  '{"provider":"photoroom"}'),
('background_remove_bria',      'clearcut', 'background.remove', 'bria',      2, 2,  '{"provider":"bria"}'),
('background_remove_removebg',  'clearcut', 'background.remove', 'removebg',  10, 20, '{"provider":"remove.bg"}');

-- 默认积分包配置（可按 project_id 独立配置）
INSERT OR IGNORE INTO credit_packages (id, project_id, package_id, name, credits, platform, currency, amount_cents, badge, sort_order) VALUES
('paypal_50_credits',  'clearcut', '50',  '50 Credits',  50,  'paypal', 'USD', 499,  NULL,   10),
('paypal_200_credits', 'clearcut', '200', '200 Credits', 200, 'paypal', 'USD', 1499, 'best', 20),
('paypal_500_credits', 'clearcut', '500', '500 Credits', 500, 'paypal', 'USD', 2999, NULL,   30);

INSERT OR IGNORE INTO credit_packages (id, project_id, package_id, name, credits, platform, external_id, currency, amount_cents, badge, sort_order) VALUES
('stripe_50_credits',  'clearcut', '50',  '50 Credits',  50,  'stripe', 'price_mock_50_credits',  'USD', 499,  NULL,   10),
('stripe_200_credits', 'clearcut', '200', '200 Credits', 200, 'stripe', 'price_mock_200_credits', 'USD', 1499, 'best', 20),
('stripe_500_credits', 'clearcut', '500', '500 Credits', 500, 'stripe', 'price_mock_500_credits', 'USD', 2999, NULL,   30),
('creem_50_credits',   'clearcut', '50',  '50 Credits',  50,  'creem',  'creem_mock_50_credits',  'USD', 499,  NULL,   10),
('creem_200_credits',  'clearcut', '200', '200 Credits', 200, 'creem',  'creem_mock_200_credits', 'USD', 1499, 'best', 20),
('creem_500_credits',  'clearcut', '500', '500 Credits', 500, 'creem',  'creem_mock_500_credits', 'USD', 2999, NULL,   30);

CREATE INDEX IF NOT EXISTS idx_user_quotas_user_project ON user_quotas(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_plan_prices_plan ON plan_prices(project_id, plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_prices_platform ON plan_prices(platform, external_id);
CREATE INDEX IF NOT EXISTS idx_usage_pricing_lookup ON usage_pricing(project_id, action, variant, is_active);
CREATE INDEX IF NOT EXISTS idx_credit_packages_lookup ON credit_packages(project_id, platform, is_active);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_project ON subscriptions(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(project_id, status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_external ON subscriptions(platform, external_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_user_project ON usage_logs(user_id, project_id);
CREATE INDEX IF NOT EXISTS idx_usage_logs_created ON usage_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_credit_purchases_user ON credit_purchases(user_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_purchases_payment ON credit_purchases(platform, external_id);
CREATE INDEX IF NOT EXISTS idx_payment_events_resource ON payment_events(platform, resource_id);
CREATE INDEX IF NOT EXISTS idx_credit_transactions_user_project ON credit_transactions(user_id, project_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_credit_transactions_external ON credit_transactions(project_id, platform, external_id);
