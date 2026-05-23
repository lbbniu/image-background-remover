// 通用 OAuth 用户处理（支持 Google / GitHub / 微信等多平台）
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { oauthAccounts, users } from '../../../db/schema.js';
import { ensureUserQuota } from '../credits/service.js';

// 仅当 email 已被 provider 验证、并且开关未关闭时，才把同 email 的本地账号自动 link。
// 否则只能新建用户（避免攻击者用受害者邮箱在未验证渠道注册后接管账号）。
function shouldAutoLinkByEmail({ email, emailVerified, allowAutoLink }) {
  if (!email) return false;
  if (allowAutoLink === false) return false;
  return emailVerified === true;
}

function nullableEmail(email) {
  return typeof email === 'string' && email.length > 0 ? email : null;
}

export async function findOrCreateOAuthUser(d1, {
  platform,
  externalId,
  email,
  emailVerified = false,
  name,
  avatar,
  projectId,
  allowAutoLink = true,
  giftedCredits,
}) {
  if (!platform || !externalId) {
    throw new Error('OAuth platform and externalId are required');
  }

  const orm = getDb(d1);
  const normalizedEmail = nullableEmail(email);

  // 1. 已有 OAuth 关联 → 同步可用字段，并刷新登录时间
  const existing = await orm
    .select({ userId: oauthAccounts.userId })
    .from(oauthAccounts)
    .innerJoin(users, eq(oauthAccounts.userId, users.id))
    .where(and(eq(oauthAccounts.platform, platform), eq(oauthAccounts.externalId, externalId)))
    .get();

  if (existing) {
    await orm
      .update(users)
      .set({
        name: sql`COALESCE(${name ?? null}, ${users.name})`,
        avatar: sql`COALESCE(${avatar ?? null}, ${users.avatar})`,
        updatedAt: sql`datetime('now')`,
        lastLogin: sql`datetime('now')`,
      })
      .where(eq(users.id, existing.userId))
      .run();

    await orm
      .update(oauthAccounts)
      .set({
        name: sql`COALESCE(${name ?? null}, ${oauthAccounts.name})`,
        avatar: sql`COALESCE(${avatar ?? null}, ${oauthAccounts.avatar})`,
        email: sql`COALESCE(${normalizedEmail}, ${oauthAccounts.email})`,
        emailVerified: emailVerified ? 1 : 0,
        updatedAt: sql`datetime('now')`,
      })
      .where(and(eq(oauthAccounts.platform, platform), eq(oauthAccounts.externalId, externalId)))
      .run();
    return existing.userId;
  }

  // 2. 仅在 email 已验证时，按 email 自动 link
  let userId;
  if (shouldAutoLinkByEmail({ email: normalizedEmail, emailVerified, allowAutoLink })) {
    const userByEmail = await orm
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .get();
    if (userByEmail) {
      userId = userByEmail.id;
      await orm
        .update(users)
        .set({
          name: sql`COALESCE(${name ?? null}, ${users.name})`,
          avatar: sql`COALESCE(${avatar ?? null}, ${users.avatar})`,
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
      .values({ email: normalizedEmail, name: name ?? null, avatar: avatar ?? null })
      .returning({ id: users.id })
      .get();
    userId = result.id;
    // 防滥用：未验证邮箱的渠道（GitHub no-public-email、Twitter 等）不发新人赠送积分。
    // 调用方若想绕开（信任的内部渠道）显式传 giftedCredits=0 之外的值并 emailVerified=true。
    const safeGifted = emailVerified === true && Number(giftedCredits) > 0
      ? giftedCredits
      : 0;
    await ensureUserQuota(d1, { userId, projectId, giftedCredits: safeGifted });
  }

  // 4. 创建 OAuth 关联
  await orm
    .insert(oauthAccounts)
    .values({
      userId,
      platform,
      externalId,
      email: normalizedEmail,
      emailVerified: emailVerified ? 1 : 0,
      name: name ?? null,
      avatar: avatar ?? null,
    })
    .run();

  return userId;
}
