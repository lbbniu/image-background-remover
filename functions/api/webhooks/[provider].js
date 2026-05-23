/**
 * Unified webhook handler — routes to provider-specific logic based on URL param.
 * POST /api/webhooks/creem
 * POST /api/webhooks/paypal
 * POST /api/webhooks/stripe  (future)
 */
import { onRequestPost as handleCreem }  from './creem.js';
import { onRequestPost as handlePayPal } from './paypal.js';

const handlers = {
  creem:  handleCreem,
  paypal: handlePayPal,
};

export async function onRequestPost(context) {
  const provider = context.params.provider?.toLowerCase();
  const handler = handlers[provider];

  if (!handler) {
    return Response.json({ error: `Unknown provider: ${provider}` }, { status: 404 });
  }

  return handler(context);
}
