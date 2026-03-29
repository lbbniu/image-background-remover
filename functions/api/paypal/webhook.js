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
        // 一次性支付成功 — 充值积分
        const orderId = resource?.supplementary_data?.related_ids?.order_id || resource?.id;
        const amount = resource?.amount?.value;

        // 查找对应的支付记录
        if (orderId) {
          const payment = await env.DB.prepare(
            'SELECT * FROM payments WHERE order_id = ? AND status = \'completed\''
          ).bind(orderId).first();

          // 如果已经通过 capture-order API 处理过，跳过
          if (payment) {
            console.log('Payment already processed via capture API:', orderId);
          } else {
            console.log('Webhook: Payment capture completed', orderId, amount);
            // 如果 capture-order API 没有处理（边缘情况），这里可以作为补偿
          }
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.ACTIVATED': {
        // 订阅激活
        const subscriptionId = resource?.id;
        const planId = resource?.plan_id;

        console.log('Webhook: Subscription activated', subscriptionId, planId);

        // 查找订阅对应的用户
        if (subscriptionId) {
          const quota = await env.DB.prepare(
            'SELECT * FROM user_quotas WHERE subscription_id = ?'
          ).bind(subscriptionId).first();

          if (quota) {
            console.log('Subscription already activated for user:', quota.user_id);
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
        console.log('Webhook: Subscription cancelled/suspended', subscriptionId);

        if (subscriptionId) {
          // 找到该订阅对应的用户，降级为 free
          const result = await env.DB.prepare(`
            UPDATE user_quotas 
            SET plan_id = 'free', credits_monthly = 10, subscription_id = NULL, updated_at = datetime('now')
            WHERE subscription_id = ?
          `).bind(subscriptionId).run();

          if (result.meta.changes > 0) {
            console.log('User downgraded to free plan');
          }
        }
        break;
      }

      case 'BILLING.SUBSCRIPTION.PAYMENT.FAILED': {
        // 订阅续费失败 — 仅记录日志，PayPal 会自动重试
        const subscriptionId = resource?.id;
        console.log('Webhook: Subscription payment failed', subscriptionId);
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
