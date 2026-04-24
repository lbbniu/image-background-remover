import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  email: text('email').unique(),
  name: text('name'),
  avatar: text('avatar'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  lastLogin: text('last_login').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_users_email').on(table.email),
]);

export const oauthAccounts = sqliteTable('oauth_accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(),
  externalId: text('external_id').notNull(),
  email: text('email'),
  name: text('name'),
  avatar: text('avatar'),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('uq_oauth_platform_external_id').on(table.platform, table.externalId),
  index('idx_oauth_user_id').on(table.userId),
  index('idx_oauth_platform').on(table.platform, table.externalId),
]);

export const subscriptionPlans = sqliteTable('subscription_plans', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().default('clearcut'),
  name: text('name').notNull(),
  priceMonthly: integer('price_monthly'),
  priceYearly: integer('price_yearly'),
  creditsMonthly: integer('credits_monthly'),
  features: text('features'),
  stripePriceId: text('stripe_price_id'),
  paypalPlanId: text('paypal_plan_id'),
  isActive: integer('is_active').default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.id, table.projectId] }),
]);

export const userQuotas = sqliteTable('user_quotas', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().default('clearcut'),
  planId: text('plan_id').default('free'),
  creditsMonthly: integer('credits_monthly').default(0),
  periodUsed: integer('period_used').default(0),
  periodStart: text('period_start'),
  periodEnd: text('period_end'),
  creditsPurchased: integer('credits_purchased').default(0),
  creditsGifted: integer('credits_gifted').default(0),
  subscriptionStatus: text('subscription_status').default('inactive'),
  subscriptionProvider: text('subscription_provider'),
  subscriptionExternalId: text('subscription_external_id'),
  totalUsed: integer('total_used').default(0),
  totalPurchased: integer('total_purchased').default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('uq_user_quotas_user_project').on(table.userId, table.projectId),
  index('idx_user_quotas_user_project').on(table.userId, table.projectId),
  index('idx_user_quotas_ext_id').on(table.subscriptionExternalId),
]);

export const usageLogs = sqliteTable('usage_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  projectId: text('project_id').notNull().default('clearcut'),
  jobId: text('job_id').unique(),
  creditsUsed: integer('credits_used').default(1),
  source: text('source'),
  status: text('status'),
  imageSize: integer('image_size'),
  processingTimeMs: integer('processing_time_ms'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_usage_logs_user_project').on(table.userId, table.projectId),
  index('idx_usage_logs_created').on(table.createdAt),
]);

export const creditPurchases = sqliteTable('credit_purchases', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  projectId: text('project_id').notNull().default('clearcut'),
  packageName: text('package_name'),
  creditsAmount: integer('credits_amount'),
  pricePaidCents: integer('price_paid_cents'),
  paymentProvider: text('payment_provider'),
  paymentIntentId: text('payment_intent_id'),
  status: text('status').default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_credit_purchases_user').on(table.userId, table.projectId),
  uniqueIndex('uq_credit_purchases_payment').on(table.paymentProvider, table.paymentIntentId),
]);
