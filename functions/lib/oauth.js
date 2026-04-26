// 通用 OAuth 用户处理（支持 Google / GitHub / 微信等多平台）
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../db/client.js';
import { oauthAccounts, users } from '../../db/schema.js';
import { ensureUserQuota } from './credits/service.js';

/**
 * 查找或创建 OAuth 用户
 * - 已有关联 → 更新信息，返回 userId
 * - 同 email 已有账号 → 自动关联，返回 userId
 * - 全新用户 → 创建用户 + OAuth 关联，返回 userId
 */
export async function findOrCreateOAuthUser(db, { platform, externalId, email, name, avatar, projectId }) {
  const orm = getDb(db);

  // 1. 查找已有的 OAuth 关联
  const existing = await orm
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .innerJoin(users, eq(oauthAccounts.userId, users.id))
    .where(and(eq(oauthAccounts.platform, platform), eq(oauthAccounts.externalId, externalId)))
    .get();

  if (existing) {
    // 更新用户信息
    await orm
      .update(users)
      .set({ name, avatar, updatedAt: sql`datetime('now')`, lastLogin: sql`datetime('now')` })
      .where(eq(users.id, existing.userId))
      .run();
    await orm
      .update(oauthAccounts)
      .set({ name, avatar, email, updatedAt: sql`datetime('now')` })
      .where(and(eq(oauthAccounts.platform, platform), eq(oauthAccounts.externalId, externalId)))
      .run();
    return existing.userId;
  }

  // 2. 检查是否有相同 email 的用户（自动关联）
  let userId;
  if (email) {
    const userByEmail = await orm
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .get();
    if (userByEmail) {
      userId = userByEmail.id;
      await orm
        .update(users)
        .set({
          name: sql`COALESCE(${name}, ${users.name})`,
          avatar: sql`COALESCE(${avatar}, ${users.avatar})`,
          updatedAt: sql`datetime('now')`,
          lastLogin: sql`datetime('now')`,
        })
        .where(eq(users.id, userId))
        .run();
    }
  }

  // 3. 全新用户 → 创建
  if (!userId) {
    const result = await orm
      .insert(users)
      .values({ email, name, avatar })
      .returning({ id: users.id })
      .get();
    userId = result.id;
    // 新用户送3次额度
    await ensureUserQuota(db, { userId, projectId });
  }

  // 4. 创建 OAuth 关联
  await orm
    .insert(oauthAccounts)
    .values({ userId, platform, externalId, email, name, avatar })
    .run();

  return userId;
}
