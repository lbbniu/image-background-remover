import { getUser } from '../../lib/auth.js';
import { createOrder } from '../../lib/paypal.js';

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
    const { packId } = await request.json();
    const pack = CREDIT_PACKS[packId];

    if (!pack) {
      return Response.json(
        { success: false, error: 'Invalid pack ID' },
        { status: 400 }
      );
    }

    // 3. 创建 PayPal 订单
    const order = await createOrder(
      env,
      pack.price,
      `ClearCut AI - ${pack.label}`
    );

    return Response.json({
      success: true,
      orderId: order.id,
    });

  } catch (error) {
    console.error('Create order error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to create order' },
      { status: 500 }
    );
  }
}
