import { and, eq } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { usagePricing } from '../../../db/schema.js';

const DEFAULT_USAGE_PRICING = {
  'background.remove:photoroom': {
    credits: 2,
    costEstimateCents: 2,
  },
  'background.remove:bria': {
    credits: 2,
    costEstimateCents: 2,
  },
  'background.remove:removebg': {
    credits: 10,
    costEstimateCents: 20,
  },
};

function normalizeKeyPart(value) {
  return String(value || '').trim().toLowerCase();
}

function readPositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : fallback;
}

function getPricingEntry(pricing, { projectId, action, variant }) {
  const normalizedProjectId = normalizeKeyPart(projectId);
  const normalizedAction = normalizeKeyPart(action);
  const normalizedVariant = normalizeKeyPart(variant);

  const candidates = [
    normalizedProjectId && normalizedVariant && `${normalizedProjectId}:${normalizedAction}:${normalizedVariant}`,
    normalizedVariant && `${normalizedAction}:${normalizedVariant}`,
    normalizedProjectId && `${normalizedProjectId}:${normalizedAction}`,
    normalizedAction,
  ].filter(Boolean);

  for (const key of candidates) {
    if (pricing[key]) return { key, entry: pricing[key] };
  }

  return null;
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizePricingEntry(entry, key) {
  if (!entry || typeof entry !== 'object') {
    throw new Error(`Invalid usage pricing entry: ${key}`);
  }

  const credits = readPositiveInteger(entry.credits, 0);
  if (!credits) {
    throw new Error(`Invalid usage pricing credits: ${key}`);
  }

  return {
    credits,
    costEstimateCents: readPositiveInteger(
      entry.costEstimateCents ?? entry.cost_estimate_cents,
      0,
    ),
    metadata: parseMetadata(entry.metadata),
  };
}

async function getDatabasePricingEntry(d1, { projectId, action, variant }) {
  if (!d1) return null;

  const db = getDb(d1);
  const normalizedProjectId = normalizeKeyPart(projectId);
  const normalizedAction = normalizeKeyPart(action);
  const normalizedVariant = normalizeKeyPart(variant);

  try {
    if (normalizedVariant) {
      const byVariant = await db
        .select()
        .from(usagePricing)
        .where(and(
          eq(usagePricing.projectId, normalizedProjectId),
          eq(usagePricing.action, normalizedAction),
          eq(usagePricing.variant, normalizedVariant),
          eq(usagePricing.isActive, 1),
        ))
        .get();
      if (byVariant) return { key: `${normalizedProjectId}:${normalizedAction}:${normalizedVariant}`, entry: byVariant };
    }

    const byDefaultVariant = await db
      .select()
      .from(usagePricing)
      .where(and(
        eq(usagePricing.projectId, normalizedProjectId),
        eq(usagePricing.action, normalizedAction),
        eq(usagePricing.variant, 'default'),
        eq(usagePricing.isActive, 1),
      ))
      .get();

    return byDefaultVariant
      ? { key: `${normalizedProjectId}:${normalizedAction}:default`, entry: byDefaultVariant }
      : null;
  } catch (error) {
    if (String(error?.message || error).includes('no such table')) return null;
    throw error;
  }
}

function getDefaultPricingEntry({ projectId, action, variant }) {
  return getPricingEntry(DEFAULT_USAGE_PRICING, { projectId, action, variant });
}

export async function resolveUsageCharge(d1, { projectId, action, variant, metadata }) {
  const normalizedAction = normalizeKeyPart(action);
  const normalizedVariant = normalizeKeyPart(variant);
  const match = await getDatabasePricingEntry(d1, {
    projectId,
    action: normalizedAction,
    variant: normalizedVariant,
  }) || getDefaultPricingEntry({
    projectId,
    action: normalizedAction,
    variant: normalizedVariant,
  });

  if (!match) {
    throw new Error(`Usage pricing not configured: ${normalizedAction}${normalizedVariant ? `:${normalizedVariant}` : ''}`);
  }

  const entry = normalizePricingEntry(match.entry, match.key);

  return {
    action: normalizedAction,
    variant: normalizedVariant || null,
    pricingKey: match.key,
    credits: entry.credits,
    costEstimateCents: entry.costEstimateCents,
    metadata: {
      ...entry.metadata,
      ...(metadata || {}),
    },
  };
}
