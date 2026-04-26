import { verifyWebhookSignature } from '../../lib/paypal.js';
import { getProjectId } from '../../lib/core/projects.js';
import { completeCreditPurchase } from '../../lib/payments/credit-purchases.js';
import { markPaymentEventProcessed, recordPaymentEvent } from '../../lib/payments/events.js';
import {
  cancelUserSubscription,
  getSubscriptionOwner,
  renewSubscriptionPeriod,
  updateSubscriptionStatus,
} from '../../lib/subscriptions/service.js';

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
    const eventId = body.id || `${eventType}:${resource?.id || crypto.randomUUID()}`;

    if (!env.DB) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    const event = await recordPaymentEvent(env.DB, {
      projectId,
      platform: 'paypal',
      externalId: eventId,
      eventType,
      resourceType: resource?.resource_type || resource?.object || 'unknown',
      resourceId: resource?.id,
      payload: body,
    });
    if (!event.inserted) {
      return Response.json({ received: true, duplicate: true });
    }

    let eventStatus = 'processed';

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED': {
        const orderId = resource?.supplementary_data?.related_ids?.order_id;
        const amount = resource?.amount?.value;
        const amountPaidCents = amount ? Math.round(Number(amount) * 100) : null;

        if (!orderId || !amountPaidCents) {
          eventStatus = 'ignored';
          break;
        }

        const result = await completeCreditPurchase(env.DB, {
          projectId,
          platform: 'paypal',
          externalId: orderId,
          amountPaidCents,
          metadata: {
            captureId: resource?.id,
            confirmation: 'paypal_webhook',
            eventId,
          },
        });

        if (!result.applied && !['already_completed'].includes(result.reason)) {
          eventStatus = result.reason === 'purchase_not_found' ? 'ignored' : 'failed';
        }
        break;
      }
      case 'CHECKOUT.ORDER.COMPLETED': {
        const orderId = resource?.id;
        const capture = resource?.purchase_units?.[0]?.payments?.captures?.[0];
        const amount = capture?.amount?.value || resource?.purchase_units?.[0]?.amount?.value;
        const amountPaidCents = amount ? Math.round(Number(amount) * 100) : null;

        if (!orderId || !amountPaidCents) {
          eventStatus = 'ignored';
          break;
        }

        const result = await completeCreditPurchase(env.DB, {
          projectId,
          platform: 'paypal',
          externalId: orderId,
          amountPaidCents,
          metadata: {
            captureId: capture?.id,
            confirmation: 'paypal_webhook',
            eventId,
          },
        });

        if (!result.applied && !['already_completed'].includes(result.reason)) {
          eventStatus = result.reason === 'purchase_not_found' ? 'ignored' : 'failed';
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        const subscriptionId = resource?.id;
        const quota = await getSubscriptionOwner(env.DB, { projectId, externalId: subscriptionId });
        if (quota) {
          await updateSubscriptionStatus(env.DB, { projectId, externalId: subscriptionId, status: 'active' });
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        const subscriptionId = resource?.id;
        const quota = await getSubscriptionOwner(env.DB, { projectId, externalId: subscriptionId });
        if (quota) {
          await cancelUserSubscription(env.DB, { userId: quota.userId, projectId });
        }
        break;
      }
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        await updateSubscriptionStatus(env.DB, {
          projectId,
          externalId: resource?.id,
          status: 'expired',
          clearSubscription: true,
        });
        break;
      }
      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        await updateSubscriptionStatus(env.DB, {
          projectId,
          externalId: resource?.id,
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
            externalId: resource?.id,
            periodEnd: nextBillingTime,
          });
        }
        break;
      }
      default:
        console.log('Unhandled PayPal webhook event:', eventType);
        eventStatus = 'ignored';
    }

    await markPaymentEventProcessed(env.DB, { platform: 'paypal', externalId: eventId, status: eventStatus });

    return Response.json({ received: true });
  } catch (error) {
    console.error('PayPal webhook error:', error);
    return Response.json({ received: true, error: error.message });
  }
}
