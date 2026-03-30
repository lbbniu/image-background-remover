// PayPal Webhook 处理器（适配新表结构）

import { activateSubscription, cancelSubscription, getProjectId } from '../../lib/quota.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const projectId = getProjectId(env);

  try {
    const body = await request.json();
    const eventType = body.event_type;
    const resource = body.resource;

    console.log('PayPal webhook event:', eventType);

    if (!env.DB) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    switch (eventType) {
      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        // 订阅首次激活
        const subscriptionId = resource?.id;
        const planId = resource?.plan_id;
        console.log('Webhook: Subscription activated', subscriptionId, planId);

        // 查找已关联的用户（通过 subscribe API 预创建的记录）
        const quota = await env.DB.prepare(
          'SELECT user_id FROM user_quotas WHERE subscription_external_id = ? AND project_id = ?'
        ).bind(subscriptionId, projectId).first();

        if (quota) {
          // 标记为 active（实际额度在 subscribe API 已设置）
          await env.DB.prepare(`
            UPDATE user_quotas 
            SET subscription_status = 'active', updated_at = datetime('now')
            WHERE subscription_external_id = ? AND project_id = ?
          `).bind(subscriptionId, projectId).run();
          console.log('Subscription confirmed active for user:', quota.user_id);
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED': {
        // 用户取消订阅 —— 标记为 cancelled，当前周期仍可用
        const subscriptionId = resource?.id;
        console.log('Webhook: Subscription cancelled', subscriptionId);

        const quota = await env.DB.prepare(
          'SELECT user_id FROM user_quotas WHERE subscription_external_id = ? AND project_id = ?'
        ).bind(subscriptionId, projectId).first();

        if (quota) {
          await cancelSubscription(env.DB, quota.user_id, projectId);
          console.log('Subscription marked as cancelled for user:', quota.user_id);
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        // 订阅过期（周期结束且未续费）
        const subscriptionId = resource?.id;
        console.log('Webhook: Subscription expired', subscriptionId);

        await env.DB.prepare(`
          UPDATE user_quotas 
          SET subscription_status = 'expired', 
              credits_monthly = 0,
              subscription_external_id = NULL,
              subscription_provider = NULL,
              updated_at = datetime('now')
          WHERE subscription_external_id = ? AND project_id = ?
        `).bind(subscriptionId, projectId).run();
        break;
      }

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        // 续费失败 —— 标记为 past_due，PayPal 会自动重试
        const subscriptionId = resource?.id;
        console.log('Webhook: Subscription payment failed', subscriptionId);

        await env.DB.prepare(`
          UPDATE user_quotas 
          SET subscription_status = 'past_due', updated_at = datetime('now')
          WHERE subscription_external_id = ? AND project_id = ?
        `).bind(subscriptionId, projectId).run();
        break;
      }

      case 'BILLING.SUBSCRIPTION.RENEWED':
      case 'BILLING.SUBSCRIPTION.PAYMENT.COMPLETED': {
        // 续费成功 —— 延长周期
        const subscriptionId = resource?.id;
        const nextBillingTime = resource?.billing_info?.next_billing_time;
        console.log('Webhook: Subscription renewed', subscriptionId, nextBillingTime);

        if (nextBillingTime) {
          await env.DB.prepare(`
            UPDATE user_quotas 
            SET period_end = ?, subscription_status = 'active', updated_at = datetime('now')
            WHERE subscription_external_id = ? AND project_id = ?
          `).bind(nextBillingTime, subscriptionId, projectId).run();
        }
        break;
      }

      default:
        console.log('Unhandled webhook event:', eventType);
    }

    // 必须返回 200 给 PayPal
    return Response.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ received: true, error: error.message });
  }
}
