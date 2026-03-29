// 订阅计划列表（GET）
// Plan IDs 从环境变量读取，或使用占位符

const DEFAULT_PLANS = {
  pro_monthly: {
    id: 'PLAN_PRO_MONTHLY_PLACEHOLDER',
    name: 'Pro Monthly',
    price: '9.90',
    interval: 'month',
    credits: 200,
  },
  pro_yearly: {
    id: 'PLAN_PRO_YEARLY_PLACEHOLDER',
    name: 'Pro Yearly',
    price: '79.00',
    interval: 'year',
    credits: 200,
  },
  biz_monthly: {
    id: 'PLAN_BIZ_MONTHLY_PLACEHOLDER',
    name: 'Business Monthly',
    price: '29.90',
    interval: 'month',
    credits: 1000,
  },
  biz_yearly: {
    id: 'PLAN_BIZ_YEARLY_PLACEHOLDER',
    name: 'Business Yearly',
    price: '239.00',
    interval: 'year',
    credits: 1000,
  },
};

export async function onRequestGet(context) {
  const { env } = context;

  // 从环境变量覆盖 Plan IDs（如果已配置）
  const plans = { ...DEFAULT_PLANS };

  if (env.PAYPAL_PLAN_PRO_MONTHLY) plans.pro_monthly.id = env.PAYPAL_PLAN_PRO_MONTHLY;
  if (env.PAYPAL_PLAN_PRO_YEARLY) plans.pro_yearly.id = env.PAYPAL_PLAN_PRO_YEARLY;
  if (env.PAYPAL_PLAN_BIZ_MONTHLY) plans.biz_monthly.id = env.PAYPAL_PLAN_BIZ_MONTHLY;
  if (env.PAYPAL_PLAN_BIZ_YEARLY) plans.biz_yearly.id = env.PAYPAL_PLAN_BIZ_YEARLY;

  return Response.json({
    success: true,
    plans,
  });
}
