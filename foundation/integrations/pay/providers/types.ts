/**
 * Provider interface and types
 */

import type {
  ChargeInput,
  ChargeResult,
  SubscribeInput,
  SubscriptionResult,
  CheckoutInput,
  CheckoutResult,
} from "../types.js";

export interface PaymentProvider {
  /**
   * Provider identifier (e.g., 'stripe', 'paddle')
   */
  readonly name: string;

  /**
   * Creates a one-time payment charge
   */
  charge(input: ChargeInput): Promise<ChargeResult>;

  /**
   * Creates a subscription
   */
  subscribe(input: SubscribeInput): Promise<SubscriptionResult>;

  /**
   * Cancels a subscription
   */
  cancel(subscriptionId: string): Promise<SubscriptionResult>;

  /**
   * Pauses a subscription
   */
  pause(subscriptionId: string): Promise<SubscriptionResult>;

  /**
   * Resumes a paused subscription
   */
  resume(subscriptionId: string): Promise<SubscriptionResult>;

  /**
   * Generates a billing portal URL
   */
  portal(email: string): Promise<string>;

  /**
   * Creates a checkout session/payment link
   * Returns a URL that can be opened in a browser to complete payment
   */
  checkout(input: CheckoutInput): Promise<CheckoutResult>;

  /**
   * Verifies webhook signature
   * For PayPal, this method is async and requires additional headers
   */
  verifyWebhook(
    payload: string | Buffer,
    signature: string,
    secret: string,
    headers?: Record<string, string>
  ): boolean | Promise<boolean>;

  /**
   * Normalizes provider-specific webhook event
   */
  normalizeWebhookEvent(rawEvent: unknown): unknown;
}
