import type { PaymentProvider } from "./types.js";
import type {
  ChargeInput,
  ChargeResult,
  SubscribeInput,
  SubscriptionResult,
  CurrencyCode,
  CheckoutInput,
  CheckoutResult,
} from "../types.js";

export class PayPalProvider implements PaymentProvider {
  readonly name = "paypal";
  private clientId: string;
  private clientSecret: string;
  private baseUrl: string;
  private webhookId: string;
  private returnUrl: string;
  private cancelUrl: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(env: Record<string, string>) {
    const clientId = env.PAYPAL_CLIENT_ID;
    const clientSecret = env.PAYPAL_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET are required for PayPal provider");
    }
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.baseUrl = env.PAYPAL_BASE_URL || (env.PAYPAL_SANDBOX === "true"
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com");
    this.webhookId = env.PAYPAL_WEBHOOK_ID || "";
    this.returnUrl = env.PAYPAL_RETURN_URL || "https://app.example.com/success";
    this.cancelUrl = env.PAYPAL_CANCEL_URL || "https://app.example.com/cancel";
  }

  private async getAccessToken(): Promise<string> {
    // Check if token is still valid
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    // Get new access token
    const auth = btoa(`${this.clientId}:${this.clientSecret}`);
    const response = await fetch(`${this.baseUrl}/v1/oauth2/token`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`PayPal auth error: ${response.status} - ${errorText}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000; // Refresh 60s early

    return this.accessToken;
  }

  private async request(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<unknown> {
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "PayPal-Request-Id": crypto.randomUUID(),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = (await response.json().catch(() => ({
        message: "Unknown error",
      }))) as {
        name?: string;
        message?: string;
        debug_id?: string;
        details?: Array<{ field?: string; issue?: string }>;
        information_link?: string;
      };

      // Parse PayPal's structured error format
      const errorMessage = error.message || "Unknown error";
      const errorName = error.name || "UNKNOWN_ERROR";
      const debugId = error.debug_id || "";
      const details = error.details || [];
      const infoLink = error.information_link || "";

      let fullMessage = `PayPal API error: ${response.status} - ${errorName}: ${errorMessage}`;
      if (debugId) {
        fullMessage += ` (debug_id: ${debugId})`;
      }
      if (details.length > 0) {
        const detailMessages = details
          .map((d) => `${d.field || "unknown"}: ${d.issue || "unknown issue"}`)
          .join(", ");
        fullMessage += ` - Details: ${detailMessages}`;
      }
      if (infoLink) {
        fullMessage += ` - More info: ${infoLink}`;
      }

      const errorObj = new Error(fullMessage);
      (errorObj as unknown as { debug_id?: string }).debug_id = debugId;
      (errorObj as unknown as { paypal_error?: typeof error }).paypal_error =
        error;
      throw errorObj;
    }

    return response.json();
  }

  async charge(input: ChargeInput): Promise<ChargeResult> {
    // PayPal uses Orders API for one-time payments
    // Note: PayPal Orders API requires user approval via redirect for most cases
    // This creates an order that will be in CREATED status until user approves
    let amount = 0;

    if (input.productId) {
      // Product ID - fetch product and use its price
      // Note: PayPal Catalog API can be used to get product details
      try {
        const product = (await this.request(
          "GET",
          `/v1/catalogs/products/${input.productId}`
        )) as {
          id: string;
          type?: string;
          pricing_models?: Array<{
            pricing_tiers?: Array<{
              amount?: { value: string; currency_code: string };
            }>;
          }>;
        };

        // Check if product is a subscription product
        // PayPal products can have type "SERVICE" for subscriptions
        // We should check if there are any subscription plans associated with this product
        // For now, we'll check the product type and warn if it might be a subscription
        if (product.type === "SERVICE") {
          // Try to check if there are subscription plans for this product
          try {
            const plans = (await this.request("GET", "/v1/billing/plans", {
              product_id: input.productId,
              page_size: 1,
            })) as {
              plans?: Array<unknown>;
            };
            if (plans.plans && plans.plans.length > 0) {
              throw new Error(
                `The product "${input.productId}" is associated with subscription plans, but you're using it with charge().\n` +
                  `To create a one-time payment, please:\n` +
                  `1. Go to your PayPal Dashboard → Products & Plans\n` +
                  `2. Create a new product for one-time payments\n` +
                  `3. Use the new product ID in charge()\n\n` +
                  `Alternatively, if you want a recurring subscription, use pay.subscribe() instead of pay.charge().`
              );
            }
          } catch (error) {
            // If it's our validation error, re-throw it
            if (
              error instanceof Error &&
              error.message.includes("associated with subscription plans")
            ) {
              throw error;
            }
            // For other errors, continue with product price extraction
          }
        }

        // Try to get price from product
        // PayPal product pricing structure can vary, so we'll try to extract it
        if (
          product.pricing_models &&
          product.pricing_models.length > 0 &&
          product.pricing_models[0].pricing_tiers &&
          product.pricing_models[0].pricing_tiers.length > 0 &&
          product.pricing_models[0].pricing_tiers[0].amount
        ) {
          const productAmount = parseFloat(
            product.pricing_models[0].pricing_tiers[0].amount.value
          );
          if (productAmount > 0) {
            amount = productAmount;
          }
        }

        if (!amount) {
          throw new Error(
            `Could not determine price for product "${input.productId}". Please provide amount directly or ensure the product has pricing configured.`
          );
        }
      } catch (error) {
        throw new Error(
          `Failed to fetch product "${input.productId}": ${error instanceof Error ? error.message : "Unknown error"}. Please provide amount directly.`
        );
      }
    } else if (input.amount) {
      amount = input.amount;
    } else {
      throw new Error(
        "PayPal requires either productId or amount for one-time payments. priceId is not supported for charges."
      );
    }

    const returnUrl = input.successUrl || this.returnUrl;
    const cancelUrl = input.cancelUrl || this.cancelUrl;

    const purchaseUnit: {
      amount: {
        currency_code: string;
        value: string;
      };
      description: string;
      payee?: { email_address: string };
      custom_id?: string;
    } = {
      amount: {
        currency_code: input.currency,
        value: amount.toFixed(2),
      },
      description: `Payment of ${amount} ${input.currency}`,
      payee: input.email
        ? {
            email_address: input.email,
          }
        : undefined,
    };

    if (input.metadata) {
      purchaseUnit.custom_id = JSON.stringify(input.metadata);
    }

    const order = (await this.request("POST", "/v2/checkout/orders", {
      intent: "CAPTURE",
      purchase_units: [purchaseUnit],
      application_context: {
        return_url: returnUrl,
        cancel_url: cancelUrl,
      },
    })) as {
      id: string;
      status: string;
      links?: Array<{ href: string; rel: string; method: string }>;
    };

    // Extract approval URL from order links
    const approvalLink = order.links?.find((link) => link.rel === "approve");
    const approvalUrl = approvalLink?.href;

    return {
      id: order.id,
      url: approvalUrl,
      status:
        order.status === "COMPLETED"
          ? "succeeded"
          : order.status === "FAILED" || order.status === "VOIDED"
            ? "failed"
            : "pending", // CREATED and other statuses map to pending
      amount,
      currency: input.currency,
      provider: this.name,
      email: input.email,
    };
  }

  /**
   * Captures a PayPal order after user approval
   * This must be called after the user approves the payment on PayPal
   *
   * @param orderId - The PayPal order ID from the charge() response
   * @returns Promise resolving to charge result with updated status
   */
  async captureOrder(orderId: string): Promise<ChargeResult> {
    const capture = (await this.request(
      "POST",
      `/v2/checkout/orders/${orderId}/capture`,
      {}
    )) as {
      id: string;
      status: string;
      purchase_units?: Array<{
        payments?: {
          captures?: Array<{
            id: string;
            status: string;
            amount: { currency_code: string; value: string };
          }>;
        };
      }>;
    };

    // Extract amount and currency from capture response
    const captureData = capture.purchase_units?.[0]?.payments?.captures?.[0];
    const amount = captureData?.amount
      ? parseFloat(captureData.amount.value)
      : 0;
    const currency = (captureData?.amount?.currency_code?.toUpperCase() ||
      "USD") as CurrencyCode;

    return {
      id: capture.id,
      status:
        capture.status === "COMPLETED"
          ? "succeeded"
          : capture.status === "FAILED" || capture.status === "VOIDED"
            ? "failed"
            : "pending",
      amount,
      currency,
      provider: this.name,
    };
  }

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    if (input.plan) {
      // Subscription checkout
      const result = await this.subscribe({
        plan: input.plan,
        currency: input.currency,
        email: input.email || "",
        successUrl: input.successUrl,
        cancelUrl: input.cancelUrl,
      });
      return {
        id: result.id,
        url: result.url || "",
        provider: this.name,
      };
    }

    if (!input.amount) {
      throw new Error("PayPal checkout requires either 'plan' or 'amount'");
    }

    // One-time payment checkout
    const result = await this.charge({
      amount: input.amount,
      currency: input.currency,
      email: input.email,
      successUrl: input.successUrl,
      cancelUrl: input.cancelUrl,
    });
    return {
      id: result.id,
      url: result.url || "",
      provider: this.name,
    };
  }

  async subscribe(input: SubscribeInput): Promise<SubscriptionResult> {
    if (!input.email) {
      throw new Error("Email is required for PayPal subscriptions");
    }

    // Validate that the plan is configured for recurring billing
    try {
      const plan = (await this.request(
        "GET",
        `/v1/billing/plans/${input.plan}`
      )) as {
        id: string;
        billing_cycles?: Array<{
          tenure_type?: string;
          frequency?: { interval_unit?: string; interval_count?: number };
        }>;
      };
      if (
        !plan.billing_cycles ||
        plan.billing_cycles.length === 0 ||
        !plan.billing_cycles.some(
          (cycle) =>
            cycle.tenure_type === "REGULAR" || cycle.tenure_type === "TRIAL"
        )
      ) {
        throw new Error(
          `The plan "${input.plan}" is not configured for recurring billing, but you're using it with subscribe().\n` +
            `To create a subscription, please:\n` +
            `1. Go to your PayPal Dashboard → Products & Plans\n` +
            `2. Create a new subscription plan with billing cycles configured\n` +
            `3. Set the billing frequency (monthly, yearly, etc.)\n` +
            `4. Use the new subscription plan ID in subscribe()\n\n` +
            `Alternatively, if you want a one-time payment, use pay.charge() instead of pay.subscribe().`
        );
      }
    } catch (error) {
      // If it's our validation error, re-throw it
      if (
        error instanceof Error &&
        error.message.includes("not configured for recurring billing")
      ) {
        throw error;
      }
      // For other errors (network, invalid plan ID, etc.), let them propagate
      // The API will handle them appropriately
    }

    // PayPal uses Subscriptions API
    // Plan ID must be pre-configured in PayPal
    const subscriptionData: {
      plan_id: string;
      subscriber: { email_address: string };
      application_context: {
        brand_name: string;
        return_url: string;
        cancel_url: string;
      };
      custom_id?: string;
    } = {
      plan_id: input.plan, // Plan ID must be pre-configured in PayPal
      subscriber: {
        email_address: input.email,
      },
      application_context: {
        brand_name: "PayLayer",
        return_url: input.successUrl || this.returnUrl,
        cancel_url: input.cancelUrl || this.cancelUrl,
      },
    };

    if (input.metadata) {
      subscriptionData.custom_id = JSON.stringify(input.metadata);
    }

    const subscription = (await this.request(
      "POST",
      "/v1/billing/subscriptions",
      subscriptionData
    )) as {
      id: string;
      status: string;
      plan_id: string;
      links?: Array<{ href: string; rel: string }>;
    };

    // Extract approval URL from subscription links
    const approvalLink = subscription.links?.find(
      (link) => link.rel === "approve" || link.rel === "approval_url"
    );
    const approvalUrl = approvalLink?.href;

    return {
      id: subscription.id,
      url: approvalUrl,
      status:
        subscription.status === "ACTIVE"
          ? "active"
          : subscription.status === "SUSPENDED"
            ? "paused"
            : subscription.status === "CANCELLED"
              ? "cancelled"
              : "active",
      plan: subscription.plan_id || input.plan,
      currency: input.currency,
      provider: this.name,
      email: input.email,
    };
  }

  async cancel(subscriptionId: string): Promise<SubscriptionResult> {
    await this.request(
      "POST",
      `/v1/billing/subscriptions/${subscriptionId}/cancel`,
      {
        reason: "User requested cancellation",
      }
    );

    const subscription = (await this.request(
      "GET",
      `/v1/billing/subscriptions/${subscriptionId}`
    )) as {
      id: string;
      status: string;
      plan_id: string;
      billing_info?: {
        outstanding_balance?: {
          currency_code: string;
          value: string;
        };
        last_payment?: {
          amount: {
            currency_code: string;
            value: string;
          };
        };
        cycle_executions?: Array<{
          tenure_type: string;
          sequence: number;
          cycles_completed: number;
          cycles_remaining: number;
          current_pricing_scheme_version?: number;
        }>;
      };
      plan?: {
        payment_preferences?: {
          auto_bill_outstanding?: boolean;
          setup_fee?: {
            currency_code: string;
            value: string;
          };
        };
      };
    };

    // Extract currency from various possible locations
    let currency: CurrencyCode = "USD";
    if (subscription.billing_info?.outstanding_balance?.currency_code) {
      currency =
        subscription.billing_info.outstanding_balance.currency_code.toUpperCase() as CurrencyCode;
    } else if (subscription.billing_info?.last_payment?.amount?.currency_code) {
      currency =
        subscription.billing_info.last_payment.amount.currency_code.toUpperCase() as CurrencyCode;
    } else if (
      subscription.plan?.payment_preferences?.setup_fee?.currency_code
    ) {
      currency =
        subscription.plan.payment_preferences.setup_fee.currency_code.toUpperCase() as CurrencyCode;
    }

    return {
      id: subscription.id,
      status: "cancelled",
      plan: subscription.plan_id || "unknown",
      currency,
      provider: this.name,
    };
  }

  async pause(subscriptionId: string): Promise<SubscriptionResult> {
    await this.request(
      "POST",
      `/v1/billing/subscriptions/${subscriptionId}/suspend`,
      {
        reason: "User requested pause",
      }
    );

    const subscription = (await this.request(
      "GET",
      `/v1/billing/subscriptions/${subscriptionId}`
    )) as {
      id: string;
      status: string;
      plan_id: string;
      billing_info?: {
        outstanding_balance?: {
          currency_code: string;
          value: string;
        };
        last_payment?: {
          amount: {
            currency_code: string;
            value: string;
          };
        };
      };
      plan?: {
        payment_preferences?: {
          setup_fee?: {
            currency_code: string;
            value: string;
          };
        };
      };
    };

    // Extract currency from various possible locations
    let currency: CurrencyCode = "USD";
    if (subscription.billing_info?.outstanding_balance?.currency_code) {
      currency =
        subscription.billing_info.outstanding_balance.currency_code.toUpperCase() as CurrencyCode;
    } else if (subscription.billing_info?.last_payment?.amount?.currency_code) {
      currency =
        subscription.billing_info.last_payment.amount.currency_code.toUpperCase() as CurrencyCode;
    } else if (
      subscription.plan?.payment_preferences?.setup_fee?.currency_code
    ) {
      currency =
        subscription.plan.payment_preferences.setup_fee.currency_code.toUpperCase() as CurrencyCode;
    }

    return {
      id: subscription.id,
      status: "paused",
      plan: subscription.plan_id || "unknown",
      currency,
      provider: this.name,
    };
  }

  async resume(subscriptionId: string): Promise<SubscriptionResult> {
    await this.request(
      "POST",
      `/v1/billing/subscriptions/${subscriptionId}/activate`,
      {
        reason: "User requested resume",
      }
    );

    const subscription = (await this.request(
      "GET",
      `/v1/billing/subscriptions/${subscriptionId}`
    )) as {
      id: string;
      status: string;
      plan_id: string;
      billing_info?: {
        outstanding_balance?: {
          currency_code: string;
          value: string;
        };
        last_payment?: {
          amount: {
            currency_code: string;
            value: string;
          };
        };
      };
      plan?: {
        payment_preferences?: {
          setup_fee?: {
            currency_code: string;
            value: string;
          };
        };
      };
    };

    // Extract currency from various possible locations
    let currency: CurrencyCode = "USD";
    if (subscription.billing_info?.outstanding_balance?.currency_code) {
      currency =
        subscription.billing_info.outstanding_balance.currency_code.toUpperCase() as CurrencyCode;
    } else if (subscription.billing_info?.last_payment?.amount?.currency_code) {
      currency =
        subscription.billing_info.last_payment.amount.currency_code.toUpperCase() as CurrencyCode;
    } else if (
      subscription.plan?.payment_preferences?.setup_fee?.currency_code
    ) {
      currency =
        subscription.plan.payment_preferences.setup_fee.currency_code.toUpperCase() as CurrencyCode;
    }

    return {
      id: subscription.id,
      status: "active",
      plan: subscription.plan_id || "unknown",
      currency,
      provider: this.name,
    };
  }

  async portal(email: string): Promise<string> {
    // PayPal account management URL
    return "https://www.paypal.com/myaccount/autopay";
  }

  async verifyWebhook(
    payload: string | Buffer,
    signature: string,
    secret: string,
    headers?: Record<string, string>
  ): Promise<boolean> {
    // PayPal webhook verification uses PayPal's verification API endpoint
    // This is the recommended approach per PayPal documentation

    if (!headers) {
      // eslint-disable-next-line no-console
      console.warn("PayPal webhook verification: Missing headers");
      return false;
    }

    // Normalize headers to lowercase for case-insensitive lookup
    const normalizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
      normalizedHeaders[key.toLowerCase()] = value;
    }

    // Extract required PayPal headers (case-insensitive)
    const authAlgo =
      normalizedHeaders["paypal-auth-algo"] ||
      normalizedHeaders["paypal_auth_algo"];
    const certUrl =
      normalizedHeaders["paypal-cert-url"] ||
      normalizedHeaders["paypal_cert_url"];
    const transmissionId =
      normalizedHeaders["paypal-transmission-id"] ||
      normalizedHeaders["paypal_transmission_id"];
    const transmissionSig =
      normalizedHeaders["paypal-transmission-sig"] ||
      normalizedHeaders["paypal_transmission_sig"];
    const transmissionTime =
      normalizedHeaders["paypal-transmission-time"] ||
      normalizedHeaders["paypal_transmission_time"];

    // Validate all required headers are present
    if (
      !authAlgo ||
      !certUrl ||
      !transmissionId ||
      !transmissionSig ||
      !transmissionTime
    ) {
      // eslint-disable-next-line no-console
      console.warn("PayPal webhook verification: Missing required headers", {
        hasAuthAlgo: !!authAlgo,
        hasCertUrl: !!certUrl,
        hasTransmissionId: !!transmissionId,
        hasTransmissionSig: !!transmissionSig,
        hasTransmissionTime: !!transmissionTime,
      });
      return false;
    }

    // Get webhook ID from environment (required for verification)
    const webhookId = secret || this.webhookId;
    if (!webhookId) {
      // eslint-disable-next-line no-console
      console.warn(
        "PAYPAL_WEBHOOK_ID not set. Webhook verification requires webhook ID."
      );
      return false;
    }

    // Parse payload as JSON for verification
    let webhookEvent: unknown;
    try {
      const payloadString =
        typeof payload === "string" ? payload : payload.toString("utf-8");
      webhookEvent = JSON.parse(payloadString);
    } catch {
      return false;
    }

    try {
      // Call PayPal's verification API endpoint
      const token = await this.getAccessToken();
      const verificationResponse = await fetch(
        `${this.baseUrl}/v1/notifications/verify-webhook-signature`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            auth_algo: authAlgo,
            cert_url: certUrl,
            transmission_id: transmissionId,
            transmission_sig: transmissionSig,
            transmission_time: transmissionTime,
            webhook_id: webhookId,
            webhook_event: webhookEvent,
          }),
        }
      );

      if (!verificationResponse.ok) {
        const errorText = await verificationResponse
          .text()
          .catch(() => "Unknown error");
        // eslint-disable-next-line no-console
        console.error(
          `PayPal webhook verification failed: ${verificationResponse.status} - ${errorText}`
        );
        return false;
      }

      const verificationResult = (await verificationResponse.json()) as {
        verification_status: string;
      };

      const isValid = verificationResult.verification_status === "SUCCESS";
      if (!isValid) {
        // eslint-disable-next-line no-console
        console.warn(
          `PayPal webhook verification status: ${verificationResult.verification_status}`
        );
      }
      return isValid;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error("PayPal webhook verification error:", error);
      return false;
    }
  }

  normalizeWebhookEvent(rawEvent: unknown): unknown {
    const event = rawEvent as {
      id?: string;
      event_type?: string;
      eventType?: string; // Alternative field name
      resource?: unknown;
      create_time?: string;
      createTime?: string; // Alternative field name
    };

    // Handle missing or alternative field names
    const eventType = event.event_type || event.eventType || "";
    const eventId = event.id || "";
    const resource = event.resource || {};
    const createTime =
      event.create_time || event.createTime || new Date().toISOString();

    return {
      type: eventType,
      id: eventId,
      resource: resource,
      create_time: createTime,
    };
  }
}
