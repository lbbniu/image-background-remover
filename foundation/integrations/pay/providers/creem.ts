import type { PaymentProvider } from "./types.js";
import type {
  ChargeInput,
  ChargeResult,
  CheckoutInput,
  CheckoutResult,
  SubscribeInput,
  SubscriptionResult,
} from "../types.js";

export class CreemProvider implements PaymentProvider {
  readonly name = "creem";
  private apiKey: string;
  private baseUrl: string;
  private webhookSecret: string;

  constructor(env: Record<string, string>) {
    const apiKey = env.CREEM_API_KEY;
    if (!apiKey) throw new Error("CREEM_API_KEY is required for Creem provider");
    this.apiKey = apiKey;
    this.baseUrl = env.CREEM_API_BASE || (env.CREEM_TEST_MODE === "true"
      ? "https://test-api.creem.io"
      : "https://api.creem.io");
    this.webhookSecret = env.CREEM_WEBHOOK_SECRET || "";
  }

  private async post(path: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "x-api-key": this.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Creem ${path} failed: ${res.status} ${err}`);
    }
    return res.json();
  }

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!input.plan) throw new Error("Creem checkout requires a product ID in the plan field");
    const data = await this.post("/v1/checkouts", {
      product_id: input.plan,
      ...(input.successUrl ? { success_url: input.successUrl } : {}),
      ...(input.email ? { customer: { email: input.email } } : {}),
    }) as { checkout_url: string; id: string };
    return { url: data.checkout_url, id: data.id, provider: this.name };
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const result = await this.checkout({
      plan: input.productId || input.priceId || "",
      currency: input.currency,
      email: input.email,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
    return {
      id: result.id,
      url: result.url,
      status: "pending",
      amount: input.amount || 0,
      currency: input.currency,
      provider: this.name,
      email: input.email,
    };
  }

  async subscribe(input: SubscribeInput): Promise<SubscriptionResult> {
    const result = await this.checkout({
      plan: input.plan,
      currency: input.currency,
      email: input.email,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
    return {
      id: result.id,
      url: result.url,
      status: "active",
      plan: input.plan,
      currency: input.currency,
      provider: this.name,
      email: input.email,
    };
  }

  async cancel(_subscriptionId: string): Promise<SubscriptionResult> {
    throw new Error("Creem subscription cancellation must be handled via the Creem dashboard or API directly");
  }

  async pause(_subscriptionId: string): Promise<SubscriptionResult> {
    throw new Error("Creem does not support pausing subscriptions");
  }

  async resume(_subscriptionId: string): Promise<SubscriptionResult> {
    throw new Error("Creem does not support resuming subscriptions");
  }

  async portal(_email: string): Promise<string> {
    throw new Error("Creem does not provide a billing portal URL");
  }

  async verifyWebhook(
    payload: string | Uint8Array,
    signature: string,
    secret: string
  ): Promise<boolean> {
    const webhookSecret = secret || this.webhookSecret;
    if (!webhookSecret || !signature) return false;
    const body = typeof payload === "string" ? payload : new TextDecoder().decode(payload);
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw", enc.encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(body));
    const computed = [...new Uint8Array(sig)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (computed.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < computed.length; i++) {
      diff |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return diff === 0;
  }

  normalizeWebhookEvent(rawEvent: unknown): unknown {
    const event = rawEvent as Record<string, unknown>;
    return {
      type: event.eventType || event.event_type || "",
      id: (event.object as Record<string, unknown>)?.id || "",
      data: event.object,
      created: event.createdAt || new Date().toISOString(),
    };
  }
}
