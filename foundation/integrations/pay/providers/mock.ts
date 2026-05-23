/**
 * Mock provider for testing and development
 */

import type { PaymentProvider } from "./types.js";
import type {
  ChargeInput,
  ChargeResult,
  SubscribeInput,
  SubscriptionResult,
  CheckoutInput,
  CheckoutResult,
} from "../types.js";

export class MockProvider implements PaymentProvider {
  readonly name = "mock";

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_env?: Record<string, string>) {}

  async charge(input: ChargeInput): Promise<ChargeResult> {
    const baseUrl = "https://checkout.paylayer.com";
    const sessionId = `ch_mock_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return {
      id: sessionId,
      url: `${baseUrl}/payment/${sessionId}?provider=${this.name}${input.productId ? `&productId=${input.productId}` : ""}`,
      status: "pending",
      amount: input.amount || 0,
      currency: input.currency,
      provider: this.name,
      email: input.email,
    };
  }

  async subscribe(input: SubscribeInput): Promise<SubscriptionResult> {
    const baseUrl =
      "https://checkout.paylayer.com";
    const sessionId = `sub_mock_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return {
      id: sessionId,
      url: `${baseUrl}/subscription/${sessionId}?provider=${this.name}`,
      status: "active",
      plan: input.plan,
      currency: input.currency,
      provider: this.name,
      email: input.email,
    };
  }

  async cancel(subscriptionId: string): Promise<SubscriptionResult> {
    return {
      id: subscriptionId,
      status: "cancelled",
      plan: "unknown",
      currency: "USD",
      provider: this.name,
    };
  }

  async pause(subscriptionId: string): Promise<SubscriptionResult> {
    return {
      id: subscriptionId,
      status: "paused",
      plan: "unknown",
      currency: "USD",
      provider: this.name,
    };
  }

  async resume(subscriptionId: string): Promise<SubscriptionResult> {
    return {
      id: subscriptionId,
      status: "active",
      plan: "unknown",
      currency: "USD",
      provider: this.name,
    };
  }

  async portal(email: string): Promise<string> {
    const baseUrl =
      "https://portal.paylayer.com";
    return `${baseUrl}/customer/${encodeURIComponent(email)}?provider=${this.name}`;
  }

  async checkout(input: CheckoutInput): Promise<CheckoutResult> {
    const baseUrl =
      "https://checkout.paylayer.com";
    const sessionId = `checkout_mock_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    return {
      url: `${baseUrl}/session/${sessionId}?provider=${this.name}`,
      id: sessionId,
      provider: this.name,
    };
  }

  verifyWebhook(): boolean {
    return true; // Mock always verifies
  }

  normalizeWebhookEvent(rawEvent: unknown): unknown {
    return rawEvent;
  }
}
