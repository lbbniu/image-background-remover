import type { EventHandler, NormalizedEvent, Provider } from "./types.js";
import { normalizeEvent } from "./events.js";
import { getProvider } from "./providers/factory.js";

// Event handler registry
const handlers: Map<string, EventHandler[]> = new Map();

/**
 * Registers a handler for payment success events
 *
 * @param handler - Function to call when payment succeeds
 *
 * @example
 * ```ts
 * pay.onPaymentSuccess((event) => {
 *   console.log('Payment succeeded:', event);
 * });
 * ```
 */
export function onPaymentSuccess(handler: EventHandler): void {
  if (!handlers.has("payment.success")) {
    handlers.set("payment.success", []);
  }
  handlers.get("payment.success")!.push(handler);
}

/**
 * Registers a handler for payment failure events
 *
 * @param handler - Function to call when payment fails
 *
 * @example
 * ```ts
 * pay.onPaymentFailed((event) => {
 *   console.log('Payment failed:', event);
 * });
 * ```
 */
export function onPaymentFailed(handler: EventHandler): void {
  if (!handlers.has("payment.failed")) {
    handlers.set("payment.failed", []);
  }
  handlers.get("payment.failed")!.push(handler);
}

/**
 * Registers a handler for subscription creation events
 *
 * @param handler - Function to call when subscription is created
 *
 * @example
 * ```ts
 * pay.onSubscriptionCreated((event) => {
 *   console.log('Subscription created:', event);
 * });
 * ```
 */
export function onSubscriptionCreated(handler: EventHandler): void {
  if (!handlers.has("subscription.created")) {
    handlers.set("subscription.created", []);
  }
  handlers.get("subscription.created")!.push(handler);
}

/**
 * Registers a handler for subscription cancellation events
 *
 * @param handler - Function to call when subscription is cancelled
 *
 * @example
 * ```ts
 * pay.onSubscriptionCancelled((event) => {
 *   console.log('Subscription cancelled:', event);
 * });
 * ```
 */
export function onSubscriptionCancelled(handler: EventHandler): void {
  if (!handlers.has("subscription.cancelled")) {
    handlers.set("subscription.cancelled", []);
  }
  handlers.get("subscription.cancelled")!.push(handler);
}

/**
 * Registers a handler for subscription update events
 *
 * @param handler - Function to call when subscription is updated
 *
 * @example
 * ```ts
 * pay.onSubscriptionUpdated((event) => {
 *   console.log('Subscription updated:', event);
 * });
 * ```
 */
export function onSubscriptionUpdated(handler: EventHandler): void {
  if (!handlers.has("subscription.updated")) {
    handlers.set("subscription.updated", []);
  }
  handlers.get("subscription.updated")!.push(handler);
}

/**
 * Registers a handler for subscription deletion events
 *
 * @param handler - Function to call when subscription is deleted
 *
 * @example
 * ```ts
 * pay.onSubscriptionDeleted((event) => {
 *   console.log('Subscription deleted:', event);
 * });
 * ```
 */
export function onSubscriptionDeleted(handler: EventHandler): void {
  if (!handlers.has("subscription.deleted")) {
    handlers.set("subscription.deleted", []);
  }
  handlers.get("subscription.deleted")!.push(handler);
}

/**
 * Registers a handler for subscription pause events
 *
 * @param handler - Function to call when subscription is paused
 *
 * @example
 * ```ts
 * pay.onSubscriptionPaused((event) => {
 *   console.log('Subscription paused:', event);
 * });
 * ```
 */
export function onSubscriptionPaused(handler: EventHandler): void {
  if (!handlers.has("subscription.paused")) {
    handlers.set("subscription.paused", []);
  }
  handlers.get("subscription.paused")!.push(handler);
}

/**
 * Registers a handler for subscription resume events
 *
 * @param handler - Function to call when subscription is resumed
 *
 * @example
 * ```ts
 * pay.onSubscriptionResumed((event) => {
 *   console.log('Subscription resumed:', event);
 * });
 * ```
 */
export function onSubscriptionResumed(handler: EventHandler): void {
  if (!handlers.has("subscription.resumed")) {
    handlers.set("subscription.resumed", []);
  }
  handlers.get("subscription.resumed")!.push(handler);
}

/**
 * Webhook request type - compatible with Express, Fetch API, and other frameworks
 */
export interface WebhookRequest {
  body: unknown;
  headers: Record<string, string> | string[][] | { [key: string]: string };
  rawBody?: string | Buffer;
}

interface ExpressRequest {
  body: unknown;
  headers:
    | Record<string, string | string[] | undefined>
    | { [key: string]: string | string[] | undefined };
  rawBody?: string | Buffer;
}

/**
 * Processes a webhook request from a payment provider
 *
 * This function:
 * 1. Verifies the webhook signature using provider-specific verification
 * 2. Normalizes the provider-specific event
 * 3. Triggers registered event handlers
 * 4. Always returns 200 if webhook is accepted
 *
 * @param req - Webhook request (Request object or compatible)
 * @returns Promise resolving to response status and body
 *
 * @example
 * ```ts
 * // Express.js example
 * app.post('/webhooks/paylayer', async (req, res) => {
 *   const result = await pay.webhook(req);
 *   res.status(result.status).json(result.body);
 * });
 * ```
 */
function normalizeExpressHeaders(
  headers:
    | Record<string, string | string[] | undefined>
    | { [key: string]: string | string[] | undefined }
): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      normalized[key] = Array.isArray(value) ? value[0] : String(value);
    }
  }
  return normalized;
}

function isExpressRequest(req: unknown): req is ExpressRequest {
  if (typeof req !== "object" || req === null) {
    return false;
  }

  const hasBody = "body" in req;
  const hasHeaders =
    "headers" in req && typeof (req as any).headers === "object";
  const hasJson = "json" in req && typeof (req as any).json === "function";

  return hasBody && hasHeaders && !hasJson;
}

export async function webhook(
  req:
    | WebhookRequest
    | ExpressRequest
    | {
        json(): Promise<unknown>;
        headers:
          | Record<string, string>
          | string[][]
          | { [key: string]: string };
      },
  env: Record<string, string> = process.env as Record<string, string>
): Promise<{ status: number; body: { received: boolean } }> {
  let normalizedReq: WebhookRequest;

  if (isExpressRequest(req)) {
    normalizedReq = {
      body: req.body,
      headers: normalizeExpressHeaders(req.headers),
      rawBody: req.rawBody,
    };
  } else {
    normalizedReq = req as WebhookRequest;
  }

  const providerName = getProviderFromRequest(normalizedReq, env);
  const provider = getProvider(env);

  let rawEvent: unknown;
  let rawPayload: string | Buffer;

  if ("json" in normalizedReq && typeof normalizedReq.json === "function") {
    rawEvent = await normalizedReq.json();
    rawPayload = JSON.stringify(rawEvent);
  } else if ("body" in normalizedReq) {
    rawEvent = normalizedReq.body;
    if (normalizedReq.rawBody) {
      rawPayload = normalizedReq.rawBody;
    } else if (typeof normalizedReq.body === "string") {
      rawPayload = normalizedReq.body;
    } else {
      rawPayload = JSON.stringify(normalizedReq.body);
    }
  } else {
    throw new Error("Invalid webhook request: missing body or json method");
  }

  const signature = getSignatureFromRequest(normalizedReq, providerName);
  const allHeaders = extractAllHeaders(normalizedReq);
  const webhookSecret = getWebhookSecret(providerName, env);

  if (webhookSecret && signature) {
    const isValid = await provider.verifyWebhook(
      rawPayload,
      signature,
      webhookSecret,
      allHeaders
    );
    if (!isValid) {
      return {
        status: 401,
        body: { received: false },
      };
    }
  }

  const normalizedEvent = normalizeEvent(providerName, rawEvent);
  const eventHandlers = handlers.get(normalizedEvent.type) || [];

  Promise.all(
    eventHandlers.map(async (handler) => {
      try {
        await handler(normalizedEvent);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(
          `Error in webhook handler for ${normalizedEvent.type}:`,
          error
        );
      }
    })
  ).catch((error) => {
    // eslint-disable-next-line no-console
    console.error("Error executing webhook handlers:", error);
  });

  return {
    status: 200,
    body: { received: true },
  };
}

function getProviderFromRequest(req: WebhookRequest, env: Record<string, string>): Provider {
  const envProvider = env.PAYMENT_PROVIDER || env.PAYLAYER_PROVIDER;
  if (envProvider) return envProvider;

  const headers = "headers" in req ? req.headers : {};
  const lowerHeaders: Record<string, string> = {};
  if (Array.isArray(headers)) {
    for (const [k, v] of headers as [string, string][]) lowerHeaders[k.toLowerCase()] = v;
  } else {
    for (const k in headers as Record<string, string>) {
      lowerHeaders[k.toLowerCase()] = (headers as Record<string, string>)[k];
    }
  }

  if (lowerHeaders["stripe-signature"]) return "stripe";
  if (lowerHeaders["paypal-transmission-sig"] || lowerHeaders["paypal-transmission-id"]) return "paypal";
  if (lowerHeaders["creem-signature"]) return "creem";
  if (lowerHeaders["paddle-signature"]) return "paddle";
  if (lowerHeaders["x-polar-signature"]) return "polar";
  if (lowerHeaders["x-signature"]) return "lemonsqueezy";

  return "mock";
}

function extractAllHeaders(req: WebhookRequest): Record<string, string> {
  const headers = "headers" in req ? req.headers : {};
  const normalized: Record<string, string> = {};

  if (Array.isArray(headers)) {
    for (const [key, value] of headers as [string, string][]) {
      normalized[key.toLowerCase()] = value;
    }
  } else {
    const headerObj = headers as Record<string, string>;
    for (const key in headerObj) {
      normalized[key.toLowerCase()] = headerObj[key];
    }
  }

  return normalized;
}

function getSignatureFromRequest(
  req: WebhookRequest,
  providerName: Provider
): string {
  const headers = "headers" in req ? req.headers : {};
  const signatureHeaders: Record<string, string> = {
    stripe: "stripe-signature",
    paddle: "paddle-signature",
    paypal: "paypal-transmission-sig",
    creem: "creem-signature",
    lemonsqueezy: "x-signature",
    polar: "x-polar-signature",
  };

  const headerName = signatureHeaders[providerName.toLowerCase()];
  if (!headerName) {
    return "";
  }

  if (Array.isArray(headers)) {
    const headerMap = new Map(headers as [string, string][]);
    return headerMap.get(headerName) || "";
  } else {
    const headerObj = headers as Record<string, string>;
    const lowerHeaders: Record<string, string> = {};
    for (const key in headerObj) {
      lowerHeaders[key.toLowerCase()] = headerObj[key];
    }
    return lowerHeaders[headerName.toLowerCase()] || "";
  }
}

function getWebhookSecret(providerName: Provider, env: Record<string, string>): string {
  const secretEnvVars: Record<string, string> = {
    stripe: "STRIPE_WEBHOOK_SECRET",
    paddle: "PADDLE_WEBHOOK_SECRET",
    paypal: "PAYPAL_WEBHOOK_ID",
    creem: "CREEM_WEBHOOK_SECRET",
    lemonsqueezy: "LEMONSQUEEZY_WEBHOOK_SECRET",
    polar: "POLAR_WEBHOOK_SECRET",
  };
  const envVar = secretEnvVars[providerName.toLowerCase()];
  return envVar ? env[envVar] || "" : "";
}

export function createWebhooks(env: Record<string, string>) {
  return {
    on: { ...{ onPaymentSuccess, onPaymentFailed, onSubscriptionCreated, onSubscriptionCancelled, onSubscriptionUpdated, onSubscriptionDeleted, onSubscriptionPaused, onSubscriptionResumed } },
    process: (req: Parameters<typeof webhook>[0]) => webhook(req, env),
  };
}
