import { getProjectId, listPlanPrices } from '../lib/quota.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'paypal';

  if (!env.DB) {
    return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
  }

  const prices = await listPlanPrices(env.DB, {
    projectId: getProjectId(env),
    platform,
  });

  return Response.json({ success: true, prices });
}
