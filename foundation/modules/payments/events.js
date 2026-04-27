import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../../../db/client.js';
import { paymentEvents } from '../../../db/schema.js';

export async function recordPaymentEvent(d1, {
  projectId,
  platform,
  externalId,
  eventType,
  resourceType,
  resourceId,
  payload,
}) {
  const db = getDb(d1);
  const result = await db
    .insert(paymentEvents)
    .values({
      projectId,
      platform,
      externalId,
      eventType,
      resourceType,
      resourceId,
      payload: payload ? JSON.stringify(payload) : null,
    })
    .onConflictDoNothing({
      target: [paymentEvents.platform, paymentEvents.externalId],
    })
    .run();

  if (result.meta?.changes) {
    return { inserted: true, status: 'received' };
  }

  const existing = await db
    .select({ status: paymentEvents.status })
    .from(paymentEvents)
    .where(and(eq(paymentEvents.platform, platform), eq(paymentEvents.externalId, externalId)))
    .get();

  return { inserted: false, status: existing?.status || 'received' };
}

export async function markPaymentEventProcessed(d1, { platform, externalId, status = 'processed' }) {
  await getDb(d1)
    .update(paymentEvents)
    .set({ status, processedAt: sql`datetime('now')` })
    .where(and(eq(paymentEvents.platform, platform), eq(paymentEvents.externalId, externalId)))
    .run();
}
