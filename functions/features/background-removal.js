const PROVIDERS = {
  photoroom: {
    name: 'photoroom',
    defaultCreditCost: 2,
    estimatedCostCents: 2,
  },
  bria: {
    name: 'bria',
    defaultCreditCost: 2,
    estimatedCostCents: 2,
  },
  removebg: {
    name: 'remove.bg',
    defaultCreditCost: 10,
    estimatedCostCents: 20,
  },
};

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : fallback;
}

function providerAvailable(env, provider) {
  if (provider === 'photoroom') return Boolean(env.PHOTOROOM_API_KEY);
  if (provider === 'bria') return Boolean(env.BRIA_API_KEY && env.BRIA_API_URL);
  if (provider === 'removebg') return Boolean(env.REMOVE_BG_API_KEY);
  return false;
}

export function selectBackgroundRemovalProvider(env) {
  const requested = (env.BACKGROUND_REMOVAL_PROVIDER || 'auto').toLowerCase();
  const normalized = requested === 'remove.bg' ? 'removebg' : requested;

  if (normalized !== 'auto') {
    if (!PROVIDERS[normalized]) {
      throw new Error(`Unsupported background removal provider: ${requested}`);
    }
    if (!providerAvailable(env, normalized)) {
      throw new Error(`Background removal provider not configured: ${requested}`);
    }
    return normalized;
  }

  for (const provider of ['photoroom', 'bria', 'removebg']) {
    if (providerAvailable(env, provider)) return provider;
  }

  throw new Error('No background removal provider configured');
}

export function getBackgroundRemovalCreditCost(env, provider) {
  if (provider === 'photoroom') {
    return readPositiveInteger(env.PHOTOROOM_CREDIT_COST, PROVIDERS.photoroom.defaultCreditCost);
  }
  if (provider === 'bria') {
    return readPositiveInteger(env.BRIA_CREDIT_COST, PROVIDERS.bria.defaultCreditCost);
  }
  return readPositiveInteger(
    env.REMOVE_BG_CREDIT_COST,
    PROVIDERS.removebg.defaultCreditCost,
  );
}

function getEstimatedCostCents(env, provider) {
  if (provider === 'photoroom') {
    return readPositiveInteger(env.PHOTOROOM_COST_ESTIMATE_CENTS, PROVIDERS.photoroom.estimatedCostCents);
  }
  if (provider === 'bria') {
    return readPositiveInteger(env.BRIA_COST_ESTIMATE_CENTS, PROVIDERS.bria.estimatedCostCents);
  }
  return readPositiveInteger(env.REMOVE_BG_COST_ESTIMATE_CENTS, PROVIDERS.removebg.estimatedCostCents);
}

async function ensureOk(response, providerName) {
  if (response.ok) return;

  const text = await response.text().catch(() => '');
  let message = text || `${providerName} API error: ${response.status}`;
  try {
    const data = JSON.parse(text);
    message = data.errors?.[0]?.title || data.message || data.error || message;
  } catch {
    // Response is not JSON.
  }

  throw new Error(message);
}

async function removeWithPhotoRoom(env, bytes) {
  const formData = new FormData();
  formData.append('image_file', new Blob([bytes]), 'image.png');
  formData.append('format', 'png');

  const response = await fetch('https://sdk.photoroom.com/v1/segment', {
    method: 'POST',
    headers: { 'x-api-key': env.PHOTOROOM_API_KEY },
    body: formData,
  });

  await ensureOk(response, 'Photoroom');
  return {
    buffer: await response.arrayBuffer(),
    providerCreditsCharged: 1,
  };
}

async function removeWithBria(env, bytes) {
  const formData = new FormData();
  formData.append('image_file', new Blob([bytes]), 'image.png');

  const response = await fetch(env.BRIA_API_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.BRIA_API_KEY}` },
    body: formData,
  });

  await ensureOk(response, 'BRIA');
  return {
    buffer: await response.arrayBuffer(),
    providerCreditsCharged: 1,
  };
}

async function removeWithRemoveBg(env, bytes) {
  const formData = new FormData();
  formData.append('image_file', new Blob([bytes]), 'image.png');
  formData.append('size', env.REMOVE_BG_SIZE || 'auto');

  const response = await fetch('https://api.remove.bg/v1.0/removebg', {
    method: 'POST',
    headers: { 'X-Api-Key': env.REMOVE_BG_API_KEY },
    body: formData,
  });

  await ensureOk(response, 'remove.bg');
  const charged = response.headers.get('X-Credits-Charged');
  return {
    buffer: await response.arrayBuffer(),
    providerCreditsCharged: charged ? Number(charged) : null,
  };
}

export async function removeImageBackground(env, bytes, provider) {
  const start = Date.now();
  const selected = provider || selectBackgroundRemovalProvider(env);
  const result = selected === 'photoroom'
    ? await removeWithPhotoRoom(env, bytes)
    : selected === 'bria'
      ? await removeWithBria(env, bytes)
      : await removeWithRemoveBg(env, bytes);

  return {
    provider: PROVIDERS[selected].name,
    internalCreditCost: getBackgroundRemovalCreditCost(env, selected),
    estimatedCostCents: getEstimatedCostCents(env, selected),
    processingTimeMs: Date.now() - start,
    ...result,
  };
}
