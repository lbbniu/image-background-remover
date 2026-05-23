/**
 * Stripe provider implementation using REST API (Cloudflare Workers compatible)
 */

import type { PaymentProvider } from "./types.js";
import type {
  ChargeInput,
  ChargeResult,
  SubscribeInput,
  SubscriptionResult,
  CheckoutInput,
  CheckoutResult,
  CurrencyCode,
} from "../types.js";
// Stripe API response types

/**
 * Stripe Customer object
 * Note: Multiple customers can have the same email address in Stripe
 */
interface StripeCustomer {
  id: string;
  email?: string;
}

interface StripeCustomerList {
  data: StripeCustomer[];
}

/**
 * Stripe PaymentIntent object
 * PaymentIntents require client-side confirmation using Stripe.js before they can succeed
 */
interface StripePaymentIntent {
  id: string;
  status:
    | "requires_payment_method"
    | "requires_confirmation"
    | "requires_action"
    | "processing"
    | "requires_capture"
    | "canceled"
    | "succeeded";
  amount: number;
  currency: string;
  client_secret: string;
}

interface StripePrice {
  id: string;
  lookup_key?: string;
  type: "one_time" | "recurring";
}

interface StripePriceList {
  data: StripePrice[];
}

/**
 * Stripe Checkout Session object
 */
interface StripeCheckoutSession {
  id: string;
  url: string;
  amount_total?: number;
}

/**
 * Stripe Subscription object
 * Subscriptions can have various statuses depending on payment state
 */
interface StripeSubscription {
  id: string;
  status:
    | "active"
    | "canceled"
    | "incomplete"
    | "incomplete_expired"
    | "past_due"
    | "trialing"
    | "unpaid"
    | "paused";
  currency: string;
  cancel_at_period_end: boolean;
  pause_collection?: { behavior: string } | null;
  items: {
    data: Array<{
      price: {
        id: string;
        lookup_key?: string;
      };
    }>;
  };
}

interface StripeBillingPortalSession {
  url: string;
}

interface StripeEvent {
  id: string;
  type: string;
  data: unknown;
  created: number;
}

/**
 * Stripe Error object
 * Contains detailed error information including type, code, and parameter
 */
interface StripeError {
  error: {
    type: string;
    message: string;
    code?: string;
    param?: string;
    decline_code?: string;
    payment_intent?: unknown;
    payment_method?: unknown;
    setup_intent?: unknown;
    source?: unknown;
  };
}

export class StripeProvider implements PaymentProvider {
  readonly name = "stripe";
  private apiKey: string;
  private webhookSecret: string;
  private readonly baseUrl = "https://api.stripe.com";

  constructor(env: Record<string, string>) {
    const apiKey = env.STRIPE_SECRET_KEY;
    if (!apiKey) {
      throw new Error("STRIPE_SECRET_KEY is required for Stripe provider");
    }
    this.apiKey = apiKey;
    this.webhookSecret = env.STRIPE_WEBHOOK_SECRET || "";
  }

  /**
   * Helper method to recursively append nested objects to form data
   * Handles deeply nested structures like line_items[0][price_data][product_data][name]
   */
  private appendNestedObject(
    formData: URLSearchParams,
    prefix: string,
    obj: Record<string, unknown>
  ): void {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = `${prefix}[${key}]`;

      if (value === undefined || value === null) {
        continue;
      }

      if (typeof value === "object" && !Array.isArray(value)) {
        this.appendNestedObject(
          formData,
          fullKey,
          value as Record<string, unknown>
        );
      } else if (Array.isArray(value)) {
        if (value.length > 0 && typeof value[0] === "string") {
          for (const item of value) {
            formData.append(`${fullKey}[]`, String(item));
          }
        } else {
          for (let i = 0; i < value.length; i++) {
            const item = value[i] as Record<string, unknown>;
            this.appendNestedObject(formData, `${fullKey}[${i}]`, item);
          }
        }
      } else {
        formData.append(fullKey, String(value));
      }
    }
  }

  private async request<T>(
    method: string,
    endpoint: string,
    params?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Stripe-Version": "2025-11-17.clover",
    };

    let body: string | undefined;
    if (params && Object.keys(params).length > 0) {
      if (method === "GET") {
        const queryParams = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (Array.isArray(value)) {
            for (const item of value) {
              queryParams.append(`${key}[]`, String(item));
            }
          } else if (value !== undefined && value !== null) {
            queryParams.append(key, String(value));
          }
        }
        const queryString = queryParams.toString();
        const fullUrl = queryString ? `${url}?${queryString}` : url;
        const response = await fetch(fullUrl, {
          method,
          headers,
        });

        if (!response.ok) {
          await this.handleError(response);
        }

        return response.json() as Promise<T>;
      } else {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
        const formData = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
          if (value === "") {
            formData.append(key, "");
            continue;
          }

          if (value === undefined || value === null) {
            continue;
          }

          if (typeof value === "object" && !Array.isArray(value)) {
            if (Object.keys(value as Record<string, unknown>).length === 0) {
              formData.append(key, "");
            } else {
              const hasNestedObjects = Object.values(
                value as Record<string, unknown>
              ).some(
                (v) => typeof v === "object" && v !== null && !Array.isArray(v)
              );

              if (hasNestedObjects) {
                this.appendNestedObject(
                  formData,
                  key,
                  value as Record<string, unknown>
                );
              } else {
                for (const [nestedKey, nestedValue] of Object.entries(
                  value as Record<string, unknown>
                )) {
                  formData.append(`${key}[${nestedKey}]`, String(nestedValue));
                }
              }
            }
          } else if (Array.isArray(value)) {
            if (value.length > 0 && typeof value[0] === "string") {
              for (const item of value) {
                formData.append(`${key}[]`, String(item));
              }
            } else {
              for (let i = 0; i < value.length; i++) {
                const item = value[i] as Record<string, unknown>;
                this.appendNestedObject(formData, `${key}[${i}]`, item);
              }
            }
          } else {
            formData.append(key, String(value));
          }
        }
        body = formData.toString();
      }
    }

    const response = await fetch(url, {
      method,
      headers,
      body,
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    return response.json() as Promise<T>;
  }

  private async handleError(response: Response): Promise<never> {
    const error = (await response.json().catch(() => ({
      error: { message: "Unknown error", type: "api_error" },
    }))) as StripeError;

    const errorInfo = error.error;
    if (!errorInfo) {
      throw new Error(`Stripe API error: ${response.status} - Unknown error`);
    }

    // Build detailed error message with all available information
    let errorMessage = `Stripe API error: ${response.status}`;

    if (errorInfo.type) {
      errorMessage += ` [${errorInfo.type}]`;
    }

    if (errorInfo.message) {
      errorMessage += ` - ${errorInfo.message}`;
    }

    if (errorInfo.code) {
      errorMessage += ` (code: ${errorInfo.code})`;
    }

    if (errorInfo.param) {
      errorMessage += ` (param: ${errorInfo.param})`;
    }

    if (errorInfo.decline_code) {
      errorMessage += ` (decline_code: ${errorInfo.decline_code})`;
    }

    throw new Error(errorMessage);
  }

  /**
   * Creates a one-time payment charge using Stripe Checkout Session
   * Returns a payment URL that can be opened in a browser to complete payment
   *
   * @param input - Charge input with amount, currency, optional email, and URLs
   * @returns Charge result with Checkout Session ID, URL, and status
   */
  async charge(input: ChargeInput): Promise<ChargeResult> {
    const successUrl =
      input.successUrl ??
      "https://app.example.com/success?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl =
      input.cancelUrl ??
      "https://app.example.com/cancel";

    let lineItems: Array<{
      price?: string;
      price_data?: {
        currency: string;
        product_data: { name: string };
        unit_amount: number;
      };
      quantity: number;
    }>;

    if (input.productId) {
      const prices = await this.request<StripePriceList>("GET", "/v1/prices", {
        product: input.productId,
        type: "one_time",
        limit: 1,
      });

      if (prices.data.length === 0) {
        throw new Error(
          `No one-time price found for product "${input.productId}". Please ensure the product has a one-time price configured.`
        );
      }

      lineItems = [
        {
          price: prices.data[0].id,
          quantity: 1,
        },
      ];
    } else if (input.priceId) {
      try {
        const price = await this.request<StripePrice>(
          "GET",
          `/v1/prices/${input.priceId}`
        );
        if (price.type === "recurring") {
          throw new Error(
            `The price "${input.priceId}" is configured as a recurring subscription, but you're using it with charge().\n` +
              `To create a one-time payment, please:\n` +
              `1. Go to your Stripe Dashboard → Products\n` +
              `2. Create a new price for this product with type "One-time"\n` +
              `3. Use the new one-time price ID in charge()\n\n` +
              `Alternatively, if you want a recurring subscription, use pay.subscribe() instead of pay.charge().`
          );
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes("configured as a recurring subscription")
        ) {
          throw error;
        }
      }

      lineItems = [
        {
          price: input.priceId,
          quantity: 1,
        },
      ];
    } else if (input.amount) {
      const amountInCents = Math.round(input.amount * 100);
      lineItems = [
        {
          price_data: {
            currency: input.currency.toLowerCase(),
            product_data: {
              name: "Payment",
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ];
    } else {
      throw new Error("Either productId, priceId, or amount must be provided");
    }

    const metadata: Record<string, string> = {
      paylayer_provider: this.name,
    };
    if (input.metadata) {
      for (const [key, value] of Object.entries(input.metadata)) {
        metadata[key] = String(value);
      }
    }

    const session = await this.request<StripeCheckoutSession>(
      "POST",
      "/v1/checkout/sessions",
      {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: lineItems,
        customer_email: input.email,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata,
      }
    );

    const amount = input.amount || 0;

    return {
      id: session.id,
      url: session.url,
      status: "pending",
      amount,
      currency: input.currency,
      provider: this.name,
      email: input.email,
    };
  }

  /**
   * Creates a subscription using Stripe Checkout Session
   * Returns a payment URL that can be opened in a browser to complete subscription
   *
   * @param input - Subscription input with plan, currency, email, and optional URLs
   * @returns Subscription result with Checkout Session ID, URL, and status
   */
  async subscribe(input: SubscribeInput): Promise<SubscriptionResult> {
    if (!input.email) {
      throw new Error("Email is required for Stripe subscriptions");
    }

    // Prioritize input URLs over environment variables
    const successUrl =
      input.successUrl ??
      "https://app.example.com/success?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl =
      input.cancelUrl ??
      "https://app.example.com/cancel";

    // Find price by plan identifier
    // Supports three formats:
    // 1. Price ID (price_xxx) - use directly
    // 2. Product ID (prod_xxx) - find first recurring price for the product
    // 3. Lookup key (string) - find price by lookup_key
    let priceId: string;

    if (input.plan.startsWith("price_")) {
      // Direct price ID
      priceId = input.plan;
    } else if (input.plan.startsWith("prod_")) {
      // Product ID - find prices for this product
      const prices = await this.request<StripePriceList>("GET", "/v1/prices", {
        product: input.plan,
        type: "recurring",
        limit: 1,
      });

      if (prices.data.length === 0) {
        throw new Error(
          `No recurring price found for product "${input.plan}". Please ensure the product has a recurring price configured.`
        );
      }

      priceId = prices.data[0].id;
    } else {
      // Lookup key - find price by lookup_key
      const prices = await this.request<StripePriceList>("GET", "/v1/prices", {
        lookup_keys: [input.plan],
        limit: 1,
      });

      if (prices.data.length === 0) {
        throw new Error(
          `No price found with lookup_key "${input.plan}". Please create a price in Stripe dashboard with this lookup_key first, or use a price ID (price_xxx) or product ID (prod_xxx).`
        );
      }

      priceId = prices.data[0].id;
    }

    // Validate that the price is recurring (not one-time)
    try {
      const price = await this.request<StripePrice>(
        "GET",
        `/v1/prices/${priceId}`
      );
      if (price.type === "one_time") {
        throw new Error(
          `The price "${priceId}" is configured as a one-time payment, but you're using it with subscribe().\n` +
            `To create a subscription, please:\n` +
            `1. Go to your Stripe Dashboard → Products\n` +
            `2. Create a new price for this product with type "Recurring"\n` +
            `3. Set the billing interval (monthly, yearly, etc.)\n` +
            `4. Use the new recurring price ID in subscribe()\n\n` +
            `Alternatively, if you want a one-time payment, use pay.charge() instead of pay.subscribe().`
        );
      }
    } catch (error) {
      // If it's our validation error, re-throw it
      if (
        error instanceof Error &&
        error.message.includes("configured as a one-time payment")
      ) {
        throw error;
      }
      // For other errors (network, invalid price ID, etc.), let them propagate
      // The API will handle them appropriately
    }

    // Create Checkout Session for subscription
    // For subscriptions, metadata must be in subscription_data.metadata to be attached to the subscription
    // Session-level metadata is only on the checkout session, not the subscription
    const sessionMetadata: Record<string, string> = {
      paylayer_provider: this.name,
      paylayer_plan: input.plan,
    };

    const subscriptionMetadata: Record<string, string> = {
      paylayer_provider: this.name,
      paylayer_plan: input.plan,
    };
    if (input.metadata) {
      for (const [key, value] of Object.entries(input.metadata)) {
        const stringValue = String(value);
        sessionMetadata[key] = stringValue;
        subscriptionMetadata[key] = stringValue; // Also add to subscription metadata
      }
    }

    const session = await this.request<StripeCheckoutSession>(
      "POST",
      "/v1/checkout/sessions",
      {
        mode: "subscription",
        payment_method_types: ["card"],
        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],
        customer_email: input.email,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: sessionMetadata,
        subscription_data: {
          metadata: subscriptionMetadata,
        },
      }
    );

    return {
      id: session.id,
      url: session.url,
      status: "active",
      plan: input.plan,
      currency: input.currency,
      provider: this.name,
      email: input.email,
    };
  }

  /**
   * Cancels a subscription at the end of the current billing period
   * The subscription remains active until the period ends
   *
   * @param subscriptionId - Stripe subscription ID
   * @returns Subscription result with updated status
   */
  async cancel(subscriptionId: string): Promise<SubscriptionResult> {
    const subscription = await this.request<StripeSubscription>(
      "POST",
      `/v1/subscriptions/${subscriptionId}`,
      {
        cancel_at_period_end: true,
      }
    );

    return {
      id: subscription.id,
      status: subscription.cancel_at_period_end ? "cancelled" : "active",
      plan:
        subscription.items.data[0]?.price.lookup_key ||
        subscription.items.data[0]?.price.id ||
        "unknown",
      currency: subscription.currency.toUpperCase() as CurrencyCode,
      provider: this.name,
    };
  }

  /**
   * Pauses payment collection for a subscription
   * Invoices generated during the pause will be marked as uncollectible
   *
   * @param subscriptionId - Stripe subscription ID
   * @returns Subscription result with paused status
   */
  async pause(subscriptionId: string): Promise<SubscriptionResult> {
    // Stripe pause collection with mark_uncollectible behavior
    const subscription = await this.request<StripeSubscription>(
      "POST",
      `/v1/subscriptions/${subscriptionId}`,
      {
        pause_collection: {
          behavior: "mark_uncollectible",
        },
      }
    );

    return {
      id: subscription.id,
      status: subscription.pause_collection ? "paused" : "active",
      plan:
        subscription.items.data[0]?.price.lookup_key ||
        subscription.items.data[0]?.price.id ||
        "unknown",
      currency: subscription.currency.toUpperCase() as CurrencyCode,
      provider: this.name,
    };
  }

  /**
   * Resumes payment collection for a paused subscription
   * Clears the pause_collection setting to resume normal billing
   *
   * @param subscriptionId - Stripe subscription ID
   * @returns Subscription result with active status
   */
  async resume(subscriptionId: string): Promise<SubscriptionResult> {
    // To remove pause_collection, send empty string
    // This will be form-encoded as pause_collection= which Stripe accepts to clear the field
    const subscription = await this.request<StripeSubscription>(
      "POST",
      `/v1/subscriptions/${subscriptionId}`,
      {
        pause_collection: "",
      }
    );

    return {
      id: subscription.id,
      status: "active",
      plan:
        subscription.items.data[0]?.price.lookup_key ||
        subscription.items.data[0]?.price.id ||
        "unknown",
      currency: subscription.currency.toUpperCase() as CurrencyCode,
      provider: this.name,
    };
  }

  /**
   * Creates a billing portal session for customer self-service
   *
   * Note: Multiple customers can have the same email in Stripe.
   * This will use the first customer found with the given email.
   *
   * @param email - Customer email address
   * @returns Billing portal URL
   */
  async portal(email: string): Promise<string> {
    // Find customer by email
    const customers = await this.request<StripeCustomerList>(
      "GET",
      "/v1/customers",
      {
        email,
        limit: 1,
      }
    );

    if (customers.data.length === 0) {
      throw new Error(`No customer found with email: ${email}`);
    }

    const customerId = customers.data[0].id;

    // Create billing portal session
    const session = await this.request<StripeBillingPortalSession>(
      "POST",
      "/v1/billing_portal/sessions",
      {
        customer: customerId,
        return_url: "https://app.example.com",
      }
    );

    return session.url;
  }

  /**
   * Creates a Stripe Checkout Session for payment or subscription
   * Returns a URL that can be opened in a browser to complete payment
   *
   * @param input - Checkout input with amount/plan, currency, email, and URLs
   * @returns Checkout result with URL and session ID
   */
  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!input.plan && !input.amount) {
      throw new Error(
        "Either 'amount' (for one-time payment) or 'plan' (for subscription) is required"
      );
    }

    // Prioritize input URLs over environment variables
    const successUrl =
      input.successUrl ??
      "https://example.com/success?session_id={CHECKOUT_SESSION_ID}";
    const cancelUrl =
      input.cancelUrl ??
      "https://example.com/cancel";

    if (input.plan) {
      // Subscription checkout
      // Find price by plan (supports price ID, product ID, or lookup key)
      let priceId: string;

      if (input.plan.startsWith("price_")) {
        priceId = input.plan;
      } else if (input.plan.startsWith("prod_")) {
        const prices = await this.request<StripePriceList>(
          "GET",
          "/v1/prices",
          {
            product: input.plan,
            type: "recurring",
            limit: 1,
          }
        );

        if (prices.data.length === 0) {
          throw new Error(
            `No recurring price found for product "${input.plan}". Please ensure the product has a recurring price configured.`
          );
        }

        priceId = prices.data[0].id;
      } else {
        const prices = await this.request<StripePriceList>(
          "GET",
          "/v1/prices",
          {
            lookup_keys: [input.plan],
            limit: 1,
          }
        );

        if (prices.data.length === 0) {
          throw new Error(
            `No price found with lookup_key "${input.plan}". Please create a price in Stripe dashboard with this lookup_key first, or use a price ID (price_xxx) or product ID (prod_xxx).`
          );
        }

        priceId = prices.data[0].id;
      }

      const session = await this.request<StripeCheckoutSession>(
        "POST",
        "/v1/checkout/sessions",
        {
          mode: "subscription",
          payment_method_types: ["card"],
          line_items: [
            {
              price: priceId,
              quantity: 1,
            },
          ],
          customer_email: input.email,
          success_url: successUrl,
          cancel_url: cancelUrl,
        }
      );

      return {
        url: session.url,
        id: session.id,
        provider: this.name,
      };
    } else {
      // One-time payment checkout
      if (!input.amount) {
        throw new Error("Amount is required for one-time payment checkout");
      }

      const amountInCents = Math.round(input.amount * 100);

      const session = await this.request<StripeCheckoutSession>(
        "POST",
        "/v1/checkout/sessions",
        {
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              price_data: {
                currency: input.currency.toLowerCase(),
                product_data: {
                  name: "Payment",
                },
                unit_amount: amountInCents,
              },
              quantity: 1,
            },
          ],
          customer_email: input.email,
          success_url: successUrl,
          cancel_url: cancelUrl,
        }
      );

      return {
        url: session.url,
        id: session.id,
        provider: this.name,
      };
    }
  }

  /**
   * Verifies Stripe webhook signature using HMAC SHA256
   *
   * Implements Stripe's webhook signature verification with 5-minute timestamp tolerance
   * to prevent replay attacks while allowing for network delays.
   *
   * @param payload - Raw webhook payload (string or Buffer)
   * @param signature - Stripe signature from 'stripe-signature' header
   * @param secret - Webhook secret (if provided, overrides STRIPE_WEBHOOK_SECRET env var)
   * @returns true if signature is valid, false otherwise
   */
  async verifyWebhook(
    payload: string | Buffer,
    signature: string,
    secret: string
  ): Promise<boolean> {
    const webhookSecret = secret || this.webhookSecret || "";
    if (!webhookSecret || !signature) return false;

    try {
      const elements = signature.split(",");
      const timestamp = elements.find((e) => e.startsWith("t="))?.substring(2);
      const signatureV1 = elements.find((e) => e.startsWith("v1="))?.substring(3);
      if (!timestamp || !signatureV1) return false;

      const timestampNum = parseInt(timestamp, 10);
      if (Math.abs(Math.floor(Date.now() / 1000) - timestampNum) > 300) return false;

      const payloadString = typeof payload === "string" ? payload : new TextDecoder().decode(payload as Uint8Array);
      const signedPayload = `${timestamp}.${payloadString}`;

      const enc = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw", enc.encode(webhookSecret),
        { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
      );
      const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signedPayload));
      const computedSignature = [...new Uint8Array(sig)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      if (computedSignature.length !== signatureV1.length) return false;
      let diff = 0;
      for (let i = 0; i < computedSignature.length; i++) {
        diff |= computedSignature.charCodeAt(i) ^ signatureV1.charCodeAt(i);
      }
      return diff === 0;
    } catch {
      return false;
    }
  }

  /**
   * Normalizes Stripe webhook event to common structure
   * Extracts type, id, data, and created timestamp from Stripe event
   *
   * @param rawEvent - Raw Stripe webhook event
   * @returns Normalized event object
   */
  normalizeWebhookEvent(rawEvent: unknown): unknown {
    const event = rawEvent as StripeEvent;
    return {
      type: event.type,
      id: event.id,
      data: event.data,
      created: event.created,
    };
  }
}
