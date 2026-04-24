import { verifyWebhookSignature } from '../../lib/paypal.js';
import {
  cancelUserSubscription,
  getProjectId,
  getSubscriptionOwner,
  renewSubscriptionPeriod,
  updateSubscriptionStatus,
} from '../../lib/quota.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const projectId = getProjectId(env);

  try {
    const rawBody = await request.text();
    if (env.PAYPAL_WEBHOOK_ID) {
      const isValid = await verifyWebhookSignature(env, request, rawBody);
      if (!isValid) {
        console.warn('PayPal webhook signature verification failed');
        return new Response('Forbidden', { status: 403 });
      }
    }

    const body = JSON.parse(rawBody);
    const eventType = body.event_type;
    const resource = body.resource;

    if (!env.DB) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const subscriptionId = resource?.id;
        const quota = await getSubscriptionOwner(env.DB, { projectId, subscriptionExternalId: subscriptionId });
        if (quota) {
          await updateSubscriptionStatus(env.DB, { projectId, subscriptionExternalId: subscriptionId, status: 'active' });
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        const subscriptionId = resource?.id;
        const quota = await getSubscriptionOwner(env.DB, { projectId, subscriptionExternalId: subscriptionId });
        if (quota) {
          await cancelUserSubscription(env.DB, { userId: quota.userId, projectId });
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        await updateSubscriptionStatus(env.DB, {
          projectId,
          subscriptionExternalId: resource?.id,
          status: 'expired',
          clearSubscription: true,
        });
        break;
      }
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        await updateSubscriptionStatus(env.DB, {
          projectId,
          subscriptionExternalId: resource?.id,
          status: 'past_due',
        });
        break;
      }
      case 'BILLING.SUBSCRIPTION.RENEWED':
      case 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED': {
        const nextBillingTime = resource?.billing_info?.next_billing_time;
        if (nextBillingTime) {
          await renewSubscriptionPeriod(env.DB, {
            projectId,
            subscriptionExternalId: resource?.id,
            periodEnd: nextBillingTime,
          });
        }
        break;
      }
      default:
        console.log('Unhandled PayPal webhook event:', eventType);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    return Response.json({ received: true, error: error.message });
  }
}
