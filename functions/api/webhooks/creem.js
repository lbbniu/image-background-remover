import { verifyCreemWebhookSignature } from '../../../foundation/integrations/index.js';
import { getProjectId } from '../../../foundation/modules/core/index.js';
import {
  completeCreditPurchase,
  getCreditPurchaseByExternalId,
  markPaymentEventProcessed,
  recordPaymentEvent,
} from '../../../foundation/modules/payments/index.js';
import { getPlanByPriceExternalId } from '../../../foundation/modules/plans/index.js';
import {
  activateUserSubscription,
  cancelUserSubscription,
  updateSubscriptionStatus,
} from '../../../foundation/modules/subscriptions/index.js';

function getObjectId(value) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.id || value.product_id || null;
}

function getMetadata(object) {
  return object?.metadata || object?.subscription?.metadata || object?.order?.metadata || {};
}

function getProductId(object) {
  return getObjectId(object?.product) || object?.product_id || getObjectId(object?.order?.product);
}

function getSubscriptionId(object) {
  return getObjectId(object?.subscription) || object?.subscription_id || object?.id;
}

function getCheckoutId(object) {
  return object?.id || object?.checkout_id;
}

async function handleCheckoutCompleted(d1, { projectId, object, eventId }) {
  const metadata = getMetadata(object);
  const kind = metadata.kind || (object?.subscription || object?.subscription_id ? 'subscription' : 'credit_purchase');

  if (kind === 'credit_purchase') {
    const checkoutId = getCheckoutId(object);
    if (!checkoutId) return 'ignored';

    const purchase = await getCreditPurchaseByExternalId(d1, {
      projectId,
      platform: 'creem',
      externalId: checkoutId,
    });
    if (!purchase) return 'ignored';

    const result = await completeCreditPurchase(d1, {
      projectId,
      platform: 'creem',
      externalId: checkoutId,
      amountPaidCents: purchase.pricePaidCents,
      metadata: {
        confirmation: 'creem_webhook',
        eventId,
        orderId: getObjectId(object?.order) || object?.order_id,
        productId: getProductId(object),
      },
    });
    return result.applied || result.reason === 'already_completed' ? 'processed' : 'failed';
  }

  if (kind === 'subscription') {
    const userId = metadata.userId;
    const productId = metadata.priceExternalId || getProductId(object);
    const subscriptionId = getSubscriptionId(object);
    if (!userId || !productId || !subscriptionId) return 'ignored';

    const plan = await getPlanByPriceExternalId(d1, {
      projectId,
      platform: 'creem',
      externalId: productId,
    });
    if (!plan) return 'ignored';

    await activateUserSubscription(d1, {
      userId,
      projectId,
      planId: plan.planId,
      platform: 'creem',
      externalId: subscriptionId,
      monthlyCredits: plan.creditsMonthly,
    });
    return 'processed';
  }

  return 'ignored';
}

async function handleSubscriptionGrant(d1, { projectId, object }) {
  const metadata = getMetadata(object);
  const userId = metadata.userId;
  const productId = metadata.priceExternalId || getProductId(object);
  const subscriptionId = getSubscriptionId(object);
  if (!userId || !productId || !subscriptionId) return 'ignored';

  const plan = await getPlanByPriceExternalId(d1, {
    projectId,
    platform: 'creem',
    externalId: productId,
  });
  if (!plan) return 'ignored';

  await activateUserSubscription(d1, {
    userId,
    projectId,
    planId: plan.planId,
    platform: 'creem',
    externalId: subscriptionId,
    monthlyCredits: plan.creditsMonthly,
  });
  return 'processed';
}

async function handleSubscriptionRevoke(d1, { projectId, object, status }) {
  const metadata = getMetadata(object);
  const subscriptionId = getSubscriptionId(object);
  if (metadata.userId) {
    await cancelUserSubscription(d1, { userId: metadata.userId, projectId });
  }
  if (subscriptionId) {
    await updateSubscriptionStatus(d1, {
      projectId,
      externalId: subscriptionId,
      status,
      clearSubscription: status === 'expired' || status === 'paused',
    });
  }
  return subscriptionId || metadata.userId ? 'processed' : 'ignored';
}

export async function onRequestPost({ request, env }) {
  const projectId = getProjectId(env);
  let eventId = null;
  let eventRecorded = false;

  try {
    const rawBody = await request.text();
    if (env.CREEM_WEBHOOK_SECRET) {
      const isValid = await verifyCreemWebhookSignature(env, request, rawBody);
      if (!isValid) {
        console.warn('Creem webhook signature verification failed');
        return new Response('Forbidden', { status: 403 });
      }
    }

    if (!env.DB) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    const body = JSON.parse(rawBody);
    const eventType = body.eventType || body.type;
    const object = body.object || body.data || {};
    eventId = body.id || `${eventType}:${getCheckoutId(object) || getSubscriptionId(object) || crypto.randomUUID()}`;

    const event = await recordPaymentEvent(env.DB, {
      projectId,
      platform: 'creem',
      externalId: eventId,
      eventType,
      resourceType: object.object || 'unknown',
      resourceId: getCheckoutId(object) || getSubscriptionId(object),
      payload: body,
    });
    eventRecorded = true;
    if (!event.inserted && event.status !== 'failed') {
      return Response.json({ received: true, duplicate: true });
    }

    let eventStatus = 'processed';
    switch (eventType) {
      case 'checkout.completed':
        eventStatus = await handleCheckoutCompleted(env.DB, { projectId, object, eventId });
        break;
      case 'subscription.active':
      case 'subscription.trialing':
      case 'subscription.paid':
        eventStatus = await handleSubscriptionGrant(env.DB, { projectId, object });
        break;
      case 'subscription.canceled':
        eventStatus = await handleSubscriptionRevoke(env.DB, { projectId, object, status: 'cancelled' });
        break;
      case 'subscription.expired':
        eventStatus = await handleSubscriptionRevoke(env.DB, { projectId, object, status: 'expired' });
        break;
      case 'subscription.paused':
        eventStatus = await handleSubscriptionRevoke(env.DB, { projectId, object, status: 'paused' });
        break;
      default:
        console.log('Unhandled Creem webhook event:', eventType);
        eventStatus = 'ignored';
    }

    await markPaymentEventProcessed(env.DB, { platform: 'creem', externalId: eventId, status: eventStatus });
    return Response.json({ received: true });
  } catch (error) {
    console.error('Creem webhook error:', error);
    if (env.DB && eventRecorded && eventId) {
      try {
        await markPaymentEventProcessed(env.DB, { platform: 'creem', externalId: eventId, status: 'failed' });
      } catch (markError) {
        console.error('Failed to mark Creem webhook event as failed:', markError);
      }
    }
    return Response.json({ received: true, error: error.message });
  }
}
