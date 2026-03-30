// 通用 OAuth 用户处理（支持 Google / GitHub / 微信等多平台）
import { initUserQuota } from './quota.js';

/**
 * 查找或创建 OAuth 用户
 * - 已有关联 → 更新信息，返回 userId
 * - 同 email 已有账号 → 自动关联，返回 userId
 * - 全新用户 → 创建用户 + OAuth 关联，返回 userId
 */
export async function findOrCreateOAuthUser(db, { provider, providerId, email, name, avatar }) {
  // 1. 查找已有的 OAuth 关联
  const existing = await db.prepare(
    'SELECT oa.user_id FROM oauth_accounts oa JOIN users u ON oa.user_id = u.id WHERE oa.provider = ? AND oa.external_id = ?'
  ).bind(provider, providerId).first();

  if (existing) {
    // 更新用户信息
    await db.prepare(
      'UPDATE users SET name = ?, avatar = ?, last_login = datetime(\'now\') WHERE id = ?'
    ).bind(name, avatar, existing.user_id).run();
    await db.prepare(
      'UPDATE oauth_accounts SET name = ?, avatar = ?, email = ? WHERE provider = ? AND external_id = ?'
    ).bind(name, avatar, email, provider, providerId).run();
    return existing.user_id;
  }

  // 2. 检查是否有相同 email 的用户（自动关联）
  let userId;
  if (email) {
    const userByEmail = await db.prepare(
      'SELECT id FROM users WHERE email = ?'
    ).bind(email).first();
    if (userByEmail) {
      userId = userByEmail.id;
      await db.prepare(
        'UPDATE users SET name = COALESCE(?, name), avatar = COALESCE(?, avatar), last_login = datetime(\'now\') WHERE id = ?'
      ).bind(name, avatar, userId).run();
    }
  }

  // 3. 全新用户 → 创建
  let isNewUser = false;
  if (!userId) {
    isNewUser = true;
    const result = await db.prepare(
      'INSERT INTO users (email, name, avatar) VALUES (?, ?, ?)'
    ).bind(email, name, avatar).run();
    userId = result.meta.last_row_id;
    // 新用户送3次额度
    await initUserQuota(db, userId);
  }

  // 4. 创建 OAuth 关联
  await db.prepare(
    'INSERT INTO oauth_accounts (user_id, provider, external_id, email, name, avatar) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, provider, providerId, email, name, avatar).run();

  return userId;
}
