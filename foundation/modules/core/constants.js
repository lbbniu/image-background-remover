// 平台、状态、来源等枚举集中管理，避免 magic string 散落在各处。

export const CREDIT_SOURCES = Object.freeze({
  monthly: 'monthly',
  purchased: 'purchased',
  gifted: 'gifted',
});

export const CREDIT_SOURCE_LIST = Object.freeze([
  CREDIT_SOURCES.monthly,
  CREDIT_SOURCES.purchased,
  CREDIT_SOURCES.gifted,
]);

export const CREDIT_TX_TYPES = Object.freeze({
  gift: 'gift',
  purchase: 'purchase',
  subscription: 'subscription',
  consume: 'consume',
  refund: 'refund',
  adjustment: 'adjustment',
});

export const USAGE_LOG_STATUS = Object.freeze({
  pending: 'pending',
  success: 'success',
  failed: 'failed',
  refunded: 'refunded',
});

export const SUBSCRIPTION_STATUS = Object.freeze({
  active: 'active',
  cancelled: 'cancelled',
  pastDue: 'past_due',
  paused: 'paused',
  expired: 'expired',
});

export const SUBSCRIPTION_LIVE_STATUSES = Object.freeze([
  SUBSCRIPTION_STATUS.active,
  SUBSCRIPTION_STATUS.cancelled,
  SUBSCRIPTION_STATUS.pastDue,
  SUBSCRIPTION_STATUS.paused,
]);

export const PURCHASE_STATUS = Object.freeze({
  pending: 'pending',
  completed: 'completed',
  refunded: 'refunded',
  failed: 'failed',
});

export const PAYMENT_EVENT_STATUS = Object.freeze({
  received: 'received',
  processed: 'processed',
  ignored: 'ignored',
  failed: 'failed',
});

export const PAYMENT_PLATFORMS = Object.freeze({
  paypal: 'paypal',
  creem: 'creem',
  stripe: 'stripe',
  system: 'system',
  internal: 'internal',
});

export const DEFAULT_PROJECT_ID = 'clearcut';
