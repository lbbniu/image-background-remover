import { getUser } from '../../../../foundation/modules/auth/index.js';
import { getProjectId } from '../../../../foundation/modules/core/index.js';
import { listUserCreditTransactions } from '../../../../foundation/modules/credits/index.js';

const ALLOWED_TYPES = new Set(['gift', 'purchase', 'subscription', 'consume', 'refund', 'adjustment']);
const ALLOWED_SOURCES = new Set(['monthly', 'purchased', 'gifted']);

function optionalAllowed(value, allowed) {
  if (!value) return undefined;
  return allowed.has(value) ? value : null;
}

export async function onRequestGet({ request, env }) {
  const user = await getUser(request, env);
  if (!user) {
    return Response.json({ error: 'Not authenticated', code: 'LOGIN_REQUIRED' }, { status: 401 });
  }

  if (!env.DB) {
    return Response.json({ error: 'Database not configured' }, { status: 500 });
  }

  const url = new URL(request.url);
  const type = optionalAllowed(url.searchParams.get('type'), ALLOWED_TYPES);
  const source = optionalAllowed(url.searchParams.get('source'), ALLOWED_SOURCES);

  if (type === null) {
    return Response.json({ error: 'Invalid transaction type' }, { status: 400 });
  }
  if (source === null) {
    return Response.json({ error: 'Invalid transaction source' }, { status: 400 });
  }

  try {
    const projectId = getProjectId(env);
    const result = await listUserCreditTransactions(env.DB, {
      userId: user.sub,
      projectId,
      type,
      source,
      limit: url.searchParams.get('limit') || 20,
      offset: url.searchParams.get('offset') || 0,
    });

    return Response.json(result);
  } catch (error) {
    console.error('Credit transactions query error:', error);
    return Response.json({ error: 'Failed to query credit transactions' }, { status: 500 });
  }
}
