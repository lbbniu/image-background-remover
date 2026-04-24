import { getUser } from '../lib/auth.js';
import { consumeCredit, getCreditConsumeOrder, getProjectId, getUserCreditBalance, refundCredit, updateUsageLog } from '../lib/quota.js';

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function generateJobId() {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

function getRemoveBgCreditCost(env) {
  const configured = Number(env.REMOVE_BG_CREDIT_COST || 10);
  return Number.isFinite(configured) && configured > 0 ? Math.ceil(configured) : 10;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const jobId = generateJobId();

  try {
    // 1. 检查登录状态
    const user = await getUser(request, env);
    if (!user) {
      return Response.json(
        { success: false, error: 'Please login to use this feature', code: 'LOGIN_REQUIRED' },
        { status: 401 }
      );
    }

    const projectId = getProjectId(env);
    const internalCreditCost = getRemoveBgCreditCost(env);

    // 2. 检查额度（需要登录才能处理）
    if (!env.DB) {
      return Response.json(
        { success: false, error: 'Database not configured' },
        { status: 500 }
      );
    }

    const quotaCheck = await getUserCreditBalance(env.DB, { userId: user.sub, projectId });
    if (!quotaCheck.allowed || quotaCheck.remaining < internalCreditCost) {
      return Response.json({
        success: false,
        error: `At least ${internalCreditCost} credits are required for HD background removal.`,
        code: 'NO_CREDITS',
        remaining: quotaCheck.remaining || 0,
        required: internalCreditCost,
        upgradeUrl: '/pricing',
      }, { status: 403 });
    }

    const { image } = await request.json();

    if (!image) {
      return Response.json(
        { success: false, error: 'No image provided' },
        { status: 400 }
      );
    }

    const base64Data = image.replace(/^data:image\/\w+;base64,/, '');
    const bytes = base64ToUint8Array(base64Data);

    if (bytes.length > 20 * 1024 * 1024) {
      return Response.json(
        { success: false, error: 'Image too large. Max 20MB.' },
        { status: 400 }
      );
    }

    const apiKey = env.REMOVE_BG_API_KEY;
    if (!apiKey) {
      return Response.json(
        { success: false, error: 'API key not configured' },
        { status: 500 }
      );
    }

    // 3. 扣减额度
    const deductResult = await consumeCredit(env.DB, {
      userId: user.sub,
      projectId,
      jobId,
      credits: internalCreditCost,
      consumeOrder: getCreditConsumeOrder(env),
    });
    if (!deductResult.success) {
      return Response.json({
        success: false,
        error: 'Failed to deduct credit. Please try again.',
        code: 'DEDUCT_FAILED',
      }, { status: 403 });
    }

    // 4. 调用 Remove.bg API
    const formData = new FormData();
    formData.append('image_file', new Blob([bytes]), 'image.png');
    formData.append('size', 'auto');

    const startTime = Date.now();
    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': apiKey },
      body: formData,
    });
    const processingTime = Date.now() - startTime;

    if (!response.ok) {
      // API 失败，尝试退还额度
      try {
        await refundCredit(env.DB, { userId: user.sub, projectId, jobId });
      } catch (e) {
        console.error('Failed to refund credit:', e);
      }

      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.errors?.[0]?.title || `API error: ${response.status}`);
    }

    const resultBuffer = await response.arrayBuffer();
    const resultBase64 = arrayBufferToBase64(resultBuffer);
    const removeBgCreditsCharged = response.headers.get('X-Credits-Charged');

    // 更新使用日志的处理时间
    try {
      await updateUsageLog(env.DB, {
        jobId,
        metadata: {
          provider: 'remove.bg',
          providerCreditsCharged: removeBgCreditsCharged ? Number(removeBgCreditsCharged) : null,
          internalCreditsCharged: internalCreditCost,
          processingTimeMs: processingTime,
        },
      });
    } catch (e) {
      console.error('Failed to update usage log:', e);
    }

    return Response.json({
      success: true,
      image: `data:image/png;base64,${resultBase64}`,
      creditsRemaining: deductResult.remaining,
      creditsCharged: internalCreditCost,
    });

  } catch (error) {
    console.error('Remove.bg API error:', error);
    return Response.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
