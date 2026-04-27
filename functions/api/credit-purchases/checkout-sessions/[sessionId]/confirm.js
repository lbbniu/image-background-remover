import { getUser } from '../../../../../foundation/modules/auth/index.js';
import { getProjectId } from '../../../../../foundation/modules/core/index.js';
import {
  completeCreditPurchase,
  getCreditPurchaseByExternalId,
} from '../../../../../foundation/modules/payments/index.js';
import {
  isMockPaymentPlatform,
  isPaymentMockEnabled,
} from '../../../../../foundation/integrations/index.js';

export async function onRequestPost({ request, env, params }) {
  try {
    const user = await getUser(request, env);
    if (!user) {
      return Response.json(
        { success: false, error: 'Login required', code: 'LOGIN_REQUIRED' },
        { status: 401 },
      );
    }

    if (!env.DB) {
      return Response.json({ success: false, error: 'Database not configured' }, { status: 500 });
    }

    const sessionId = params.sessionId;
    if (!sessionId) {
      return Response.json({ success: false, error: 'Checkout session ID required' }, { status: 400 });
    }

    const { platform } = await request.json();
    if (!isMockPaymentPlatform(platform)) {
      return Response.json(
        { success: false, error: 'Unsupported mock checkout platform' },
        { status: 400 },
      );
    }
    if (!isPaymentMockEnabled(env)) {
      return Response.json(
        { success: false, error: `${platform} mock payment is disabled` },
        { status: 503 },
      );
    }

    const projectId = getProjectId(env);
    const purchase = await getCreditPurchaseByExternalId(env.DB, {
      projectId,
      platform,
      externalId: sessionId,
    });
    if (!purchase) {
      return Response.json({ success: false, error: 'Unknown checkout session' }, { status: 404 });
    }
    if (String(purchase.userId) !== String(user.sub)) {
      return Response.json({ success: false, error: 'Checkout session does not belong to current user' }, { status: 403 });
    }
    if (purchase.status === 'completed') {
      return Response.json({ success: true, credits: purchase.creditsAmount, label: purchase.packageName });
    }

    const result = await completeCreditPurchase(env.DB, {
      projectId,
      platform,
      externalId: sessionId,
      amountPaidCents: purchase.pricePaidCents,
      metadata: {
        confirmation: `${platform}_mock_confirm`,
        mock: true,
      },
    });
    if (!result.applied && !['already_completed'].includes(result.reason)) {
      return Response.json({ success: false, error: result.reason || 'Failed to apply credits' }, { status: 400 });
    }

    return Response.json({ success: true, credits: purchase.creditsAmount, label: purchase.packageName });
  } catch (error) {
    console.error('Confirm mock checkout session error:', error);
    return Response.json(
      { success: false, error: error.message || 'Failed to confirm checkout session' },
      { status: 500 },
    );
  }
}
