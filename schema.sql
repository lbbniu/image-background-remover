-- ClearCut D1 数据库表结构（多平台 OAuth 版）
-- 创建方式: wrangler d1 execute clearcut-db --file=schema.sql --remote

-- 用户主表（平台无关）
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE,
  name TEXT,
  avatar TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT DEFAULT (datetime('now'))
);

-- OAuth 关联表（支持 Google / GitHub / 微信等多平台）
CREATE TABLE IF NOT EXISTS oauth_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,          -- 'google', 'github', 'wechat' ...
  provider_id TEXT NOT NULL,       -- 平台用户唯一 ID
  provider_email TEXT,
  provider_name TEXT,
  provider_avatar TEXT,
  access_token TEXT,
  refresh_token TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(provider, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_oauth_user_id ON oauth_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_accounts(provider, provider_id);
