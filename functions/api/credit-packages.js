import { getProjectId } from '../../foundation/modules/core/projects.js';
import { listCreditPackages } from '../../foundation/modules/payments/credit-purchases.js';

export async function onRequestGet({ request, env }) {
  if (!env.DB) {
    return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
  }

  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || 'paypal';
  const packages = await listCreditPackages(env.DB, {
    projectId: getProjectId(env),
    platform,
  });

  return Response.json({ success: true, packages });
}
