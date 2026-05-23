import type { PaymentProvider } from "./types.js";
import { StripeProvider } from "./stripe.js";
import { PayPalProvider } from "./paypal.js";
import { CreemProvider } from "./creem.js";
import { MockProvider } from "./mock.js";

export function getProvider(env: Record<string, string>): PaymentProvider {
  const name = (env?.PAYMENT_PROVIDER || env?.PAYLAYER_PROVIDER || "mock").toLowerCase();
  switch (name) {
    case "stripe": return new StripeProvider(env);
    case "paypal": return new PayPalProvider(env);
    case "creem":  return new CreemProvider(env);
    default:       return new MockProvider(env);
  }
}
