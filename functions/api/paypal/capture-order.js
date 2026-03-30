import { getUser } from '../../lib/auth.js';
import { captureOrder } from '../../lib/paypal.js';

const CREDIT_PACKS = {
  '50':  { credits: 50,  price: '4.99',  label: '50 Credits' },
  '200': { credits: 200, price: '14.99', label: '200 Credits' },
  '500': { credits: 500, price: '29.99', label: '500 Credits' },
};

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    // 1. 验证登录
    const user = await getUser(request, env);
    if (!user) {
      return Response.json(
        { success: false, error: 'Login required', code: 'LOGIN_REQUIRED' },
        { status: 401 }
      );
    }

    // 2. 解析请求
    const { orderId } = await request.json();
    if (!orderId) {
      return Response.json(
        { success: false, error: 'Order ID required' },
        { status: 400 }
      );
    }

    // 3. 确认支付
    const captureData = await captureOrder(env, orderId);

    if (captureData.status !== 'COMPLETED') {
      return Response.json(
        { success: false, error: 'Payment not completed', status: captureData.status },
        { status: 400 }
      );
    }

    // 4. 从支付详情中解析积分包
    const capture = captureData.purchase_units?.[0]?.payments?.captures?.[0];
    const amountPaid = capture?.amount?.value;

    // 根据支付金额匹配积分包
    let creditsToAdd = 0;
    let packLabel = '';
    for (const [, pack] of Object.entries(CREDIT_PACKS)) {
      if (pack.price === amountPaid) {
        creditsToAdd = pack.credits;
        packLabel = pack.label;
        break;
      }
    }

    if (creditsToAdd === 0) {
      // Fallback: 如果金额不匹配，仍记录但不加积分
      console.error('Amount mismatch:', amountPaid);
      return Response.json(
        { success: false, error: 'Amount mismatch' },
        { status: 400 }
      );
    }

    // 5. 更新用户积分（bonus credits）+ 记录支付
    if (env.DB) {
      const priceCents = Math.round(parseFloat(amountPaid) * 100);
      const projectId = env.PROJECT_ID || 'clearcut';

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE user_quotas 
          SET credits_purchased = credits_purchased + ?, 
              total_purchased = total_purchased + ?,
              updated_at = datetime('now')
          WHERE user_id = ? AND project_id = ?
        `).bind(creditsToAdd, creditsToAdd, user.sub, projectId),

        env.DB.prepare(`
          INSERT INTO credit_purchases (user_id, package_name, credits_amount, price_paid_cents, payment_provider, payment_intent_id, status, project_id, created_at)
          VALUES (?, ?, ?, ?, 'paypal', ?, 'completed', ?, datetime('now'))
        `).bind(user.sub, packLabel, creditsToAdd, priceCents, orderId, projectId),
      ]);
    }

    return Response.json({
      success: true,
      credits: creditsToAdd,
      label: packLabel,
    });

  } catch (error) {
    console.error('Capture order error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to capture order' },
      { status: 500 }
    );
  }
}
