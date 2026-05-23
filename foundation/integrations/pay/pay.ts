import type {
  ChargeInput,
  ChargeResult,
  SubscribeInput,
  SubscriptionResult,
  CheckoutInput,
  CheckoutResult,
} from "./types.js";
import { getProvider } from "./providers/factory.js";

async function charge(env: Record<string, string>, input: ChargeInput): Promise<ChargeResult> {
  if (!input.amount && !input.priceId && !input.productId) {
    throw new Error("Either amount, priceId, or productId must be provided");
  }
  if (input.amount && input.amount <= 0) throw new Error("Amount must be greater than 0");
  if (!input.currency) throw new Error("Currency is required");
  return getProvider(env).charge(input);
}

async function subscribe(env: Record<string, string>, input: SubscribeInput): Promise<SubscriptionResult> {
  if (!input.plan) throw new Error("Plan is required");
  if (!input.currency) throw new Error("Currency is required");
  return getProvider(env).subscribe(input);
}

async function cancel(env: Record<string, string>, subscriptionId: string): Promise<SubscriptionResult> {
  if (!subscriptionId) throw new Error("Subscription ID is required");
  return getProvider(env).cancel(subscriptionId);
}

async function pause(env: Record<string, string>, subscriptionId: string): Promise<SubscriptionResult> {
  if (!subscriptionId) throw new Error("Subscription ID is required");
  return getProvider(env).pause(subscriptionId);
}

async function resume(env: Record<string, string>, subscriptionId: string): Promise<SubscriptionResult> {
  if (!subscriptionId) throw new Error("Subscription ID is required");
  return getProvider(env).resume(subscriptionId);
}

async function portal(env: Record<string, string>, input: { email: string }): Promise<string> {
  if (!input.email) throw new Error("Email is required for billing portal");
  return getProvider(env).portal(input.email);
}

async function checkout(env: Record<string, string>, input: CheckoutInput): Promise<CheckoutResult> {
  if (!input.currency) throw new Error("Currency is required for checkout");
  return getProvider(env).checkout(input);
}

export function createPay(env: Record<string, string>) {
  return {
    charge:    (input: ChargeInput)       => charge(env, input),
    subscribe: (input: SubscribeInput)    => subscribe(env, input),
    cancel:    (id: string)               => cancel(env, id),
    pause:     (id: string)               => pause(env, id),
    resume:    (id: string)               => resume(env, id),
    portal:    (input: { email: string }) => portal(env, input),
    checkout:  (input: CheckoutInput)     => checkout(env, input),
  };
}

// Static export retained for non-Workers (Next.js) contexts
export const pay = {
  charge:    (input: ChargeInput)       => charge(process.env as Record<string, string>, input),
  subscribe: (input: SubscribeInput)    => subscribe(process.env as Record<string, string>, input),
  cancel:    (id: string)               => cancel(process.env as Record<string, string>, id),
  pause:     (id: string)               => pause(process.env as Record<string, string>, id),
  resume:    (id: string)               => resume(process.env as Record<string, string>, id),
  portal:    (input: { email: string }) => portal(process.env as Record<string, string>, input),
  checkout:  (input: CheckoutInput)     => checkout(process.env as Record<string, string>, input),
};
