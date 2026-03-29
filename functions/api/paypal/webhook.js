// PayPal Webhook 处理器（无需登录）

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const eventType = body.event_type;
    const resource = body.resource;

    console.log('PayPal webhook event:', eventType);

    // TODO: 沙箱阶段跳过签名验证，生产环境需要验证 webhook 签名
    // const webhookId = env.PAYPAL_WEBHOOK_ID;
    // await verifyWebhookSignature(request, env, webhookId);

    if (!env.DB) {
      return Response.json({ error: 'Database not configured' }, { status: 500 });
    }

    switch (eventType) {
      case 'PAYMENT.CAPTURE.COMPLETED': {
        // 一次性支付成功 — 通常已由 capture-order API 处理
        const orderId = resource?.supplementary_data?.related_ids?.order_id || resource?.id;
        const amount = resource?.amount?.value;

        if (orderId) {
          const existing = await env.DB.prepare(
            "SELECT * FROM credit_purchases WHERE payment_intent_id = ? AND status = 'completed'"
          ).bind(orderId).first();

          if (existing) {
            console.log('Payment already processed via capture API:', orderId);
          } else {
            console.log('Webhook: Payment capture completed (not yet in DB)', orderId, amount);
            // 边缘情况：capture-order API 没处理到，这里做补偿
            // 由于没有 user context，仅记录日志，不自动充值
          }
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        // 订阅激活
        const subscriptionId = resource?.id;
        const planId = resource?.plan_id;

        console.log('Webhook: Subscription activated', subscriptionId, planId);

        if (subscriptionId) {
          const quota = await env.DB.prepare(
            'SELECT * FROM user_quotas WHERE payment_subscription_id = ?'
          ).bind(subscriptionId).first();

          if (quota) {
            // 确保订阅状态为 active
            await env.DB.prepare(`
              UPDATE user_quotas 
              SET subscription_status = 'active', updated_at = datetime('now')
              WHERE payment_subscription_id = ?
            `).bind(subscriptionId).run();
            console.log('Subscription confirmed active for user:', quota.user_id);
          } else {
            console.log('Subscription not yet linked to user, will be handled by subscribe API');
          }
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.CANCELLED':
      case 'BILLING.SUBSCRIPTION.SUSPENDED':
      case 'BILLING.SUBSCRIPTION.EXPIRED': {
        // 订阅取消/暂停/过期 — 降级到免费版
        const subscriptionId = resource?.id;
        console.log('Webhook: Subscription ended', eventType, subscriptionId);

        if (subscriptionId) {
          const result = await env.DB.prepare(`
            UPDATE user_quotas 
            SET plan_id = 'free',
                credits_monthly = 0,
                subscription_status = 'inactive',
                payment_subscription_id = NULL,
                payment_provider = NULL,
                updated_at = datetime('now')
            WHERE payment_subscription_id = ?
          `).bind(subscriptionId).run();

          if (result.meta.changes > 0) {
            console.log('User downgraded to free plan');
          }
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        // 订阅续费失败 — 标记状态，PayPal 会自动重试
        const subscriptionId = resource?.id;
        console.log('Webhook: Subscription payment failed', subscriptionId);

        if (subscriptionId) {
          await env.DB.prepare(`
            UPDATE user_quotas 
            SET subscription_status = 'past_due', updated_at = datetime('now')
            WHERE payment_subscription_id = ?
          `).bind(subscriptionId).run();
        }
        break;
      }

      default:
        console.log('Unhandled webhook event:', eventType);
    }

    // 必须返回 200 给 PayPal，否则它会重试
    return Response.json({ received: true });

  } catch (error) {
    console.error('Webhook error:', error);
    // 即使出错也返回 200，避免 PayPal 无限重试
    return Response.json({ received: true, error: error.message });
  }
}
