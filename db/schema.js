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
  isActive: integer('is_active').default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.id, table.projectId] }),
]);

export const planPrices = sqliteTable('plan_prices', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().default('clearcut'),
  planId: text('plan_id').notNull(),
  platform: text('platform').notNull(),
  externalId: text('external_id').notNull(),
  interval: text('interval').notNull(),
  currency: text('currency').notNull().default('USD'),
  amountCents: integer('amount_cents').notNull(),
  isActive: integer('is_active').default(1),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.id, table.projectId] }),
  uniqueIndex('uq_plan_prices_platform_external').on(table.platform, table.externalId),
  index('idx_plan_prices_plan').on(table.projectId, table.planId),
  index('idx_plan_prices_platform').on(table.platform, table.externalId),
]);

export const usagePricing = sqliteTable('usage_pricing', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().default('clearcut'),
  action: text('action').notNull(),
  variant: text('variant').notNull().default('default'),
  credits: integer('credits').notNull(),
  costEstimateCents: integer('cost_estimate_cents').default(0),
  metadata: text('metadata'),
  isActive: integer('is_active').default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.id, table.projectId] }),
  uniqueIndex('uq_usage_pricing_project_action_variant').on(table.projectId, table.action, table.variant),
  index('idx_usage_pricing_lookup').on(table.projectId, table.action, table.variant, table.isActive),
]);

export const creditPackages = sqliteTable('credit_packages', {
  id: text('id').notNull(),
  projectId: text('project_id').notNull().default('clearcut'),
  packageId: text('package_id').notNull(),
  name: text('name').notNull(),
  credits: integer('credits').notNull(),
  platform: text('platform').notNull(),
  externalId: text('external_id'),
  currency: text('currency').notNull().default('USD'),
  amountCents: integer('amount_cents').notNull(),
  badge: text('badge'),
  sortOrder: integer('sort_order').default(0),
  metadata: text('metadata'),
  isActive: integer('is_active').default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  primaryKey({ columns: [table.id, table.projectId] }),
  uniqueIndex('uq_credit_packages_project_platform_package').on(table.projectId, table.platform, table.packageId),
  index('idx_credit_packages_lookup').on(table.projectId, table.platform, table.isActive),
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
  totalUsed: integer('total_used').default(0),
  totalPurchased: integer('total_purchased').default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('uq_user_quotas_user_project').on(table.userId, table.projectId),
  index('idx_user_quotas_user_project').on(table.userId, table.projectId),
]);

export const subscriptions = sqliteTable('subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().default('clearcut'),
  planId: text('plan_id').notNull(),
  platform: text('platform').notNull(),
  externalId: text('external_id').notNull(),
  status: text('status').notNull().default('active'),
  currentPeriodStart: text('current_period_start'),
  currentPeriodEnd: text('current_period_end'),
  cancelAtPeriodEnd: integer('cancel_at_period_end').default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  uniqueIndex('uq_subscriptions_platform_external').on(table.platform, table.externalId),
  index('idx_subscriptions_user_project').on(table.userId, table.projectId),
  index('idx_subscriptions_status').on(table.projectId, table.status),
  index('idx_subscriptions_external').on(table.platform, table.externalId),
]);

export const usageLogs = sqliteTable('usage_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').references(() => users.id),
  projectId: text('project_id').notNull().default('clearcut'),
  jobId: text('job_id').unique(),
  creditsUsed: integer('credits_used').default(1),
  source: text('source'),
  status: text('status'),
  metadata: text('metadata'),
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
  platform: text('platform'),
  externalId: text('external_id'),
  status: text('status').default('pending'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_credit_purchases_user').on(table.userId, table.projectId),
  uniqueIndex('uq_credit_purchases_payment').on(table.platform, table.externalId),
]);

export const paymentEvents = sqliteTable('payment_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  projectId: text('project_id').notNull().default('clearcut'),
  platform: text('platform').notNull(),
  externalId: text('external_id').notNull(),
  eventType: text('event_type').notNull(),
  resourceType: text('resource_type'),
  resourceId: text('resource_id'),
  status: text('status').default('received'),
  payload: text('payload'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  processedAt: text('processed_at'),
}, (table) => [
  uniqueIndex('uq_payment_events_platform_external').on(table.platform, table.externalId),
  index('idx_payment_events_resource').on(table.platform, table.resourceId),
]);

export const creditTransactions = sqliteTable('credit_transactions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().default('clearcut'),
  type: text('type').notNull(),
  source: text('source'),
  amount: integer('amount').notNull(),
  platform: text('platform'),
  externalId: text('external_id'),
  metadata: text('metadata'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (table) => [
  index('idx_credit_transactions_user_project').on(table.userId, table.projectId),
  uniqueIndex('uq_credit_transactions_external').on(table.projectId, table.platform, table.externalId),
]);
