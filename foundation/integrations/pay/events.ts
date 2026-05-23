import type {
  EventType,
  NormalizedEvent,
  Provider,
  CurrencyCode,
  CustomerInfo,
} from "./types.js";
import { getProvider } from "./providers/factory.js";

interface ExtractedEventData {
  amount?: number;
  currency?: CurrencyCode;
  email?: string;
  subscriptionId?: string;
  paymentId?: string;
  customerId?: string;
  customer?: CustomerInfo;
  status?: string;
  description?: string;
  createdAt?: string;
  plan?: string;
  productId?: string;
}

interface RawEventWithIncluded {
  meta?: unknown;
  data?: unknown;
  included?: Array<{
    type: string;
    id: string;
    attributes?: Record<string, unknown>;
  }>;
}

function mapStripeEventType(eventType: string): EventType {
  if (
    eventType.includes("payment_intent.succeeded") ||
    eventType.includes("charge.succeeded") ||
    eventType.includes("checkout.session.completed")
  ) {
    return "payment.success";
  }
  if (
    eventType.includes("payment_intent.payment_failed") ||
    eventType.includes("charge.failed")
  ) {
    return "payment.failed";
  }
  if (eventType.includes("customer.subscription.created")) {
    return "subscription.created";
  }
  if (eventType.includes("customer.subscription.updated")) {
    return "subscription.updated";
  }
  if (eventType.includes("customer.subscription.deleted")) {
    return "subscription.deleted";
  }
  if (eventType.includes("customer.subscription.canceled")) {
    return "subscription.cancelled";
  }
  if (eventType.includes("customer.subscription.paused")) {
    return "subscription.paused";
  }
  if (eventType.includes("customer.subscription.resumed")) {
    return "subscription.resumed";
  }
  return "payment.success";
}

function mapPaddleEventType(eventType: string): EventType {
  if (eventType.includes("transaction.completed")) {
    return "payment.success";
  }
  if (eventType.includes("transaction.failed")) {
    return "payment.failed";
  }
  if (eventType.includes("subscription.created")) {
    return "subscription.created";
  }
  if (eventType.includes("subscription.updated")) {
    return "subscription.updated";
  }
  if (
    eventType.includes("subscription.canceled") ||
    eventType.includes("subscription.cancelled")
  ) {
    return "subscription.cancelled";
  }
  if (eventType.includes("subscription.paused")) {
    return "subscription.paused";
  }
  if (eventType.includes("subscription.resumed")) {
    return "subscription.resumed";
  }
  return "payment.success";
}

function mapPayPalEventType(eventType: string): EventType {
  if (eventType.includes("payment.capture.completed")) {
    return "payment.success";
  }
  if (
    eventType.includes("payment.capture.denied") ||
    eventType.includes("payment.capture.reversed")
  ) {
    return "payment.failed";
  }
  if (eventType.includes("payment.capture.pending")) {
    return "payment.success";
  }
  if (eventType.includes("billing.subscription.created")) {
    return "subscription.created";
  }
  if (eventType.includes("billing.subscription.updated")) {
    return "subscription.updated";
  }
  if (eventType.includes("billing.subscription.cancelled")) {
    return "subscription.cancelled";
  }
  if (eventType.includes("billing.subscription.suspended")) {
    return "subscription.paused";
  }
  if (eventType.includes("billing.subscription.activated")) {
    return "subscription.resumed";
  }
  if (eventType.includes("billing.subscription.payment.failed")) {
    return "payment.failed";
  }
  return "payment.success";
}

function mapLemonSqueezyEventType(eventType: string): EventType {
  if (
    eventType.includes("order_created") ||
    eventType.includes("subscription_payment_success")
  ) {
    return "payment.success";
  }
  if (eventType.includes("subscription_payment_failed")) {
    return "payment.failed";
  }
  if (eventType.includes("subscription_created")) {
    return "subscription.created";
  }
  if (eventType.includes("subscription_updated")) {
    return "subscription.updated";
  }
  if (
    eventType.includes("subscription_cancelled") ||
    eventType.includes("subscription_canceled")
  ) {
    return "subscription.cancelled";
  }
  if (eventType.includes("subscription_paused")) {
    return "subscription.paused";
  }
  if (
    eventType.includes("subscription_unpaused") ||
    eventType.includes("subscription_resumed")
  ) {
    return "subscription.resumed";
  }
  if (eventType.includes("subscription_expired")) {
    return "subscription.cancelled";
  }
  return "payment.success";
}

function mapPolarEventType(
  eventType: string,
  event: Record<string, unknown>
): EventType {
  if (
    eventType.includes("checkout.completed") ||
    (eventType.includes("checkout.updated") &&
      (event.data as { status?: string })?.status === "completed")
  ) {
    return "payment.success";
  }
  if (
    eventType.includes("checkout.failed") ||
    (eventType.includes("checkout.updated") &&
      (event.data as { status?: string })?.status === "failed")
  ) {
    return "payment.failed";
  }
  if (eventType.includes("subscription.created")) {
    return "subscription.created";
  }
  if (
    eventType.includes("subscription.cancelled") ||
    eventType.includes("subscription.canceled")
  ) {
    return "subscription.cancelled";
  }
  if (
    eventType.includes("subscription.updated") &&
    (event.data as { cancel_at_period_end?: boolean })?.cancel_at_period_end ===
      true
  ) {
    return "subscription.paused";
  }
  if (
    eventType.includes("subscription.updated") &&
    (event.data as { cancel_at_period_end?: boolean })?.cancel_at_period_end ===
      false &&
    (event.data as { status?: string })?.status === "active"
  ) {
    return "subscription.resumed";
  }
  if (eventType.includes("subscription.updated")) {
    return "subscription.updated";
  }
  return "payment.success";
}

function mapCreemEventType(eventType: string): EventType {
  if (eventType.includes("checkout.completed") || eventType.includes("payment.succeeded")) {
    return "payment.success";
  }
  if (eventType.includes("payment.failed") || eventType.includes("checkout.failed")) {
    return "payment.failed";
  }
  if (eventType.includes("subscription.active") || eventType.includes("subscription.created")) {
    return "subscription.created";
  }
  if (eventType.includes("subscription.updated")) return "subscription.updated";
  if (eventType.includes("subscription.cancelled") || eventType.includes("subscription.canceled")) {
    return "subscription.cancelled";
  }
  if (eventType.includes("subscription.paused")) return "subscription.paused";
  if (eventType.includes("subscription.resumed") || eventType.includes("subscription.unpaused")) {
    return "subscription.resumed";
  }
  return "payment.success";
}

function mapGenericEventType(eventType: string): EventType {
  if (eventType.includes("subscription.created")) {
    return "subscription.created";
  }
  if (eventType.includes("subscription.updated")) {
    return "subscription.updated";
  }
  if (eventType.includes("subscription.deleted")) {
    return "subscription.deleted";
  }
  if (
    eventType.includes("subscription.cancelled") ||
    eventType.includes("subscription.canceled")
  ) {
    return "subscription.cancelled";
  }
  if (eventType.includes("subscription.paused")) {
    return "subscription.paused";
  }
  if (eventType.includes("subscription.resumed")) {
    return "subscription.resumed";
  }
  if (
    eventType.includes("payment.failed") ||
    eventType.includes("charge.failed")
  ) {
    return "payment.failed";
  }
  if (
    eventType.includes("payment.success") ||
    eventType.includes("charge.succeeded")
  ) {
    return "payment.success";
  }
  return "payment.success";
}

function extractCustomerId(data: Record<string, unknown>): string | undefined {
  if (typeof data.customer === "string" && data.customer !== null) {
    return data.customer;
  }
  if (
    data.customer &&
    typeof data.customer === "object" &&
    data.customer !== null
  ) {
    const customerObj = data.customer as Record<string, unknown>;
    return typeof customerObj.id === "string" ? customerObj.id : undefined;
  }
  if (typeof data.customer_id === "string") {
    return data.customer_id;
  }
  return undefined;
}

function extractEmailFromObject(
  obj: Record<string, unknown>,
  paths: string[]
): string | undefined {
  for (const path of paths) {
    const parts = path.split(".");
    let current: unknown = obj;
    for (const part of parts) {
      if (
        current &&
        typeof current === "object" &&
        current !== null &&
        part in current
      ) {
        current = (current as Record<string, unknown>)[part];
      } else {
        current = undefined;
        break;
      }
    }
    if (typeof current === "string") {
      return current;
    }
  }
  return undefined;
}

function extractStripeEmail(
  data: Record<string, unknown>,
  eventType: string
): string | undefined {
  const emailPaths = [
    "customer.email",
    "customer_details.email",
    "customer_email",
    "latest_invoice.customer_details.email",
    "latest_invoice.customer_email",
    "latest_invoice.customer.email",
    "default_payment_method.customer.email",
    "default_source.customer.email",
    "metadata.email",
    "metadata.customer_email",
    "pending_setup_intent.customer.email",
  ];

  let email = extractEmailFromObject(data, emailPaths);

  if (!email && data.items && typeof data.items === "object") {
    const items = data.items as {
      data?: Array<{
        subscription?: { customer?: { email?: string } };
      }>;
    };
    if (items.data) {
      for (const item of items.data) {
        if (item.subscription?.customer?.email) {
          email = item.subscription.customer.email;
          break;
        }
      }
    }
  }

  if (!email && eventType.includes("subscription") && data.latest_invoice) {
    const latestInvoice =
      typeof data.latest_invoice === "object" && data.latest_invoice !== null
        ? (data.latest_invoice as Record<string, unknown>)
        : null;
    if (latestInvoice) {
      email = extractEmailFromObject(latestInvoice, [
        "customer_details.email",
        "customer_email",
        "customer.email",
      ]);
    }
  }

  return email;
}

function extractStripeSubscriptionData(
  data: Record<string, unknown>,
  eventType: string
): Partial<ExtractedEventData> {
  const result: Partial<ExtractedEventData> = {};

  result.subscriptionId = typeof data.id === "string" ? data.id : undefined;

  result.customerId = extractCustomerId(data);

  if (data.items && typeof data.items === "object" && data.items !== null) {
    const items = data.items as {
      data?: Array<{
        price?: {
          unit_amount?: number;
          currency?: string;
          id?: string;
          lookup_key?: string;
          product?: string;
        };
      }>;
    };
    if (items.data && items.data.length > 0) {
      const firstItem = items.data[0];
      if (firstItem.price) {
        if (
          typeof firstItem.price.unit_amount === "number" &&
          firstItem.price.unit_amount > 0
        ) {
          result.amount = firstItem.price.unit_amount / 100;
        }
        if (typeof firstItem.price.currency === "string") {
          result.currency =
            firstItem.price.currency.toUpperCase() as CurrencyCode;
        }
        result.plan =
          typeof firstItem.price.lookup_key === "string"
            ? firstItem.price.lookup_key
            : typeof firstItem.price.id === "string"
              ? firstItem.price.id
              : undefined;
        result.productId =
          typeof firstItem.price.product === "string"
            ? firstItem.price.product
            : undefined;
      }
    }
  } else if (data.plan && typeof data.plan === "object") {
    const planObj = data.plan as Record<string, unknown>;
    if (typeof planObj.amount === "number" && planObj.amount > 0) {
      result.amount = (planObj.amount as number) / 100;
    }
    if (typeof planObj.currency === "string") {
      result.currency = planObj.currency.toUpperCase() as CurrencyCode;
    }
    result.plan =
      typeof planObj.lookup_key === "string"
        ? planObj.lookup_key
        : typeof planObj.id === "string"
          ? planObj.id
          : undefined;
    result.productId =
      typeof planObj.product === "string" ? planObj.product : undefined;
  } else if (data.latest_invoice) {
    const latestInvoice =
      typeof data.latest_invoice === "object" && data.latest_invoice !== null
        ? (data.latest_invoice as Record<string, unknown>)
        : null;
    if (latestInvoice) {
      if (typeof latestInvoice.amount_due === "number") {
        result.amount = latestInvoice.amount_due / 100;
      } else if (typeof latestInvoice.total === "number") {
        result.amount = latestInvoice.total / 100;
      }
      if (typeof latestInvoice.currency === "string") {
        result.currency = latestInvoice.currency.toUpperCase() as CurrencyCode;
      }
    }
  }

  result.email = extractStripeEmail(data, eventType);

  result.status = typeof data.status === "string" ? data.status : undefined;
  result.description =
    typeof data.description === "string" ? data.description : undefined;

  if (result.email || result.customerId) {
    result.customer = {
      id: result.customerId,
      email: result.email,
    };
  }

  if (typeof data.created === "number") {
    result.createdAt = new Date(data.created * 1000).toISOString();
  }

  return result;
}

function extractStripePaymentData(
  data: Record<string, unknown>,
  event: Record<string, unknown>
): Partial<ExtractedEventData> {
  const result: Partial<ExtractedEventData> = {};

  if (typeof data.amount_total === "number") {
    result.amount = data.amount_total / 100;
  } else if (typeof data.amount === "number") {
    result.amount = data.amount / 100;
  }

  result.currency =
    typeof data.currency === "string"
      ? (data.currency.toUpperCase() as CurrencyCode)
      : undefined;

  result.customerId = extractCustomerId(data);

  if (!result.customerId && data.payment_intent) {
    if (
      typeof data.payment_intent === "object" &&
      data.payment_intent !== null
    ) {
      const paymentIntent = data.payment_intent as Record<string, unknown>;
      if (typeof paymentIntent.customer === "string") {
        result.customerId = paymentIntent.customer;
      } else if (
        paymentIntent.customer &&
        typeof paymentIntent.customer === "object" &&
        paymentIntent.customer !== null
      ) {
        const piCustomer = paymentIntent.customer as Record<string, unknown>;
        if (typeof piCustomer.id === "string") {
          result.customerId = piCustomer.id;
        }
      }
    }
  }

  if (!result.customerId && data.subscription) {
    const subscription =
      typeof data.subscription === "object" && data.subscription !== null
        ? (data.subscription as Record<string, unknown>)
        : null;
    if (subscription) {
      result.customerId = extractCustomerId(subscription);
    }
  }

  if (typeof data.customer_email === "string") {
    result.email = data.customer_email;
  } else if (
    data.customer_details &&
    typeof data.customer_details === "object" &&
    data.customer_details !== null
  ) {
    const customerDetails = data.customer_details as Record<string, unknown>;
    result.email =
      typeof customerDetails.email === "string"
        ? customerDetails.email
        : result.email;
  }

  if (!result.customerId && data.payment_method) {
    const paymentMethod =
      typeof data.payment_method === "object" && data.payment_method !== null
        ? (data.payment_method as Record<string, unknown>)
        : null;
    if (paymentMethod && typeof paymentMethod.customer === "string") {
      result.customerId = paymentMethod.customer;
    }
  }

  if (!result.customerId && data.charge && typeof data.charge === "object") {
    const chargeObj = data.charge as Record<string, unknown>;
    if (typeof chargeObj.customer === "string") {
      result.customerId = chargeObj.customer;
    }
  }

  if (result.email || result.customerId) {
    result.customer = {
      id: result.customerId,
      email: result.email,
    };

    if (
      data.customer_details &&
      typeof data.customer_details === "object" &&
      data.customer_details !== null
    ) {
      const customerDetails = data.customer_details as Record<string, unknown>;

      if (typeof customerDetails.name === "string") {
        result.customer = { ...result.customer, name: customerDetails.name };
      }

      if (typeof customerDetails.phone === "string") {
        result.customer = { ...result.customer, phone: customerDetails.phone };
      }

      if (
        customerDetails.address &&
        typeof customerDetails.address === "object" &&
        customerDetails.address !== null
      ) {
        const addr = customerDetails.address as Record<string, unknown>;
        result.customer = {
          ...result.customer,
          address: {
            line1: typeof addr.line1 === "string" ? addr.line1 : undefined,
            line2: typeof addr.line2 === "string" ? addr.line2 : undefined,
            city: typeof addr.city === "string" ? addr.city : undefined,
            state: typeof addr.state === "string" ? addr.state : undefined,
            postalCode:
              typeof addr.postal_code === "string"
                ? addr.postal_code
                : typeof addr.postalCode === "string"
                  ? addr.postalCode
                  : undefined,
            country:
              typeof addr.country === "string" ? addr.country : undefined,
          },
        };
      }
    }
  }

  if (typeof data.subscription === "string") {
    result.subscriptionId = data.subscription;
  } else if (
    typeof data.id === "string" &&
    String(data.object || "").includes("subscription")
  ) {
    result.subscriptionId = data.id;
  }

  result.paymentId = typeof data.id === "string" ? data.id : undefined;
  result.status = typeof data.status === "string" ? data.status : undefined;
  result.description =
    typeof data.description === "string" ? data.description : undefined;

  if (data.line_items && Array.isArray(data.line_items)) {
    const lineItem = data.line_items[0] as Record<string, unknown>;
    if (lineItem.price) {
      const price = lineItem.price as Record<string, unknown>;
      result.plan =
        typeof price.lookup_key === "string"
          ? price.lookup_key
          : typeof price.id === "string"
            ? price.id
            : undefined;
      result.productId =
        typeof price.product === "string" ? price.product : undefined;
    }
  } else if (data.items && Array.isArray(data.items)) {
    const item = data.items[0] as Record<string, unknown>;
    if (item.price) {
      const price = item.price as Record<string, unknown>;
      result.plan =
        typeof price.lookup_key === "string"
          ? price.lookup_key
          : typeof price.id === "string"
            ? price.id
            : undefined;
      result.productId =
        typeof price.product === "string" ? price.product : undefined;
    }
  }

  if (typeof event.created === "number") {
    result.createdAt = new Date(event.created * 1000).toISOString();
  } else if (typeof data.created === "number") {
    result.createdAt = new Date(data.created * 1000).toISOString();
  }

  return result;
}

function extractStripeEventData(
  event: Record<string, unknown>,
  eventType: string
): Partial<ExtractedEventData> {
  if (!event.data) return {};

  const eventData = event.data as { object: Record<string, unknown> };
  const data = eventData.object;

  const isSubscriptionObject =
    eventType.includes("subscription") &&
    typeof data.id === "string" &&
    (data.items !== undefined ||
      data.plan !== undefined ||
      data.status !== undefined ||
      data.customer !== undefined);

  if (isSubscriptionObject) {
    return extractStripeSubscriptionData(data, eventType);
  } else {
    const result = extractStripePaymentData(data, event);
    if (typeof event.created === "number") {
      result.createdAt = new Date(event.created * 1000).toISOString();
    }
    return result;
  }
}

function extractPaddleEventData(
  event: Record<string, unknown>,
  eventType: string,
  rawEvent: unknown
): Partial<ExtractedEventData> {
  if (!event.data) return {};

  const data = event.data as Record<string, unknown>;
  const result: Partial<ExtractedEventData> = {};
  const rawPaddleEvent = rawEvent as RawEventWithIncluded | null;
  const isSubscriptionEvent = eventType.includes("subscription");

  if (
    isSubscriptionEvent &&
    data.items &&
    Array.isArray(data.items) &&
    data.items.length > 0
  ) {
    const firstItem = data.items[0] as Record<string, unknown>;

    if (
      firstItem.price &&
      typeof firstItem.price === "object" &&
      firstItem.price !== null
    ) {
      const price = firstItem.price as Record<string, unknown>;
      if (
        price.unit_price &&
        typeof price.unit_price === "object" &&
        price.unit_price !== null
      ) {
        const unitPrice = price.unit_price as Record<string, unknown>;
        if (typeof unitPrice.amount === "string") {
          result.amount = parseFloat(unitPrice.amount) / 100;
        } else if (typeof unitPrice.amount === "number") {
          result.amount = unitPrice.amount / 100;
        }
        if (typeof unitPrice.currency_code === "string") {
          result.currency =
            unitPrice.currency_code.toUpperCase() as CurrencyCode;
        }
      }
      if (!result.amount && typeof price.amount === "number") {
        result.amount = price.amount / 100;
      }
      if (!result.currency && typeof price.currency_code === "string") {
        result.currency = price.currency_code.toUpperCase() as CurrencyCode;
      }
      result.plan = typeof price.id === "string" ? price.id : undefined;
      result.productId =
        typeof price.product_id === "string" ? price.product_id : undefined;
    }

    if (!result.plan && typeof firstItem.price_id === "string") {
      result.plan = firstItem.price_id;
    }
    if (!result.productId && typeof firstItem.product_id === "string") {
      result.productId = firstItem.product_id;
    }
  }

  if (result.amount === undefined) {
    result.amount =
      typeof data.amount === "number" ? data.amount / 100 : undefined;
  }
  if (!result.currency) {
    result.currency =
      typeof data.currency_code === "string"
        ? (data.currency_code.toUpperCase() as CurrencyCode)
        : undefined;
  }

  result.email =
    typeof data.customer_email === "string" ? data.customer_email : undefined;

  if (!result.email && data.customer && typeof data.customer === "object") {
    const customer = data.customer as Record<string, unknown>;
    if (typeof customer.email === "string") {
      result.email = customer.email;
    }
  }

  if (
    !result.email &&
    data.transaction &&
    typeof data.transaction === "object"
  ) {
    const transaction = data.transaction as Record<string, unknown>;
    if (typeof transaction.customer_email === "string") {
      result.email = transaction.customer_email;
    } else if (
      transaction.customer &&
      typeof transaction.customer === "object"
    ) {
      const txCustomer = transaction.customer as Record<string, unknown>;
      if (typeof txCustomer.email === "string") {
        result.email = txCustomer.email;
      }
    }
  }

  if (!result.email && rawPaddleEvent?.data) {
    const rawData = rawPaddleEvent.data as Record<string, unknown>;
    if (rawData.customer && typeof rawData.customer === "object") {
      const rawCustomer = rawData.customer as Record<string, unknown>;
      if (typeof rawCustomer.email === "string") {
        result.email = rawCustomer.email;
      }
    }
    if (!result.email && typeof rawData.customer_email === "string") {
      result.email = rawData.customer_email;
    }
  }

  if (
    !result.email &&
    rawPaddleEvent?.included &&
    Array.isArray(rawPaddleEvent.included)
  ) {
    for (const resource of rawPaddleEvent.included) {
      if (resource.type === "customer" && resource.attributes) {
        if (typeof resource.attributes.email === "string") {
          result.email = resource.attributes.email;
          break;
        }
      }
    }
  }

  if (
    !result.email &&
    data.custom_data &&
    typeof data.custom_data === "object"
  ) {
    const customData = data.custom_data as Record<string, unknown>;
    if (typeof customData.email === "string") {
      result.email = customData.email;
    }
  }

  if (!result.email && data.metadata && typeof data.metadata === "object") {
    const metadata = data.metadata as Record<string, unknown>;
    if (typeof metadata.email === "string") {
      result.email = metadata.email;
    } else if (typeof metadata.customer_email === "string") {
      result.email = metadata.customer_email;
    }
  }

  result.subscriptionId =
    typeof data.subscription_id === "string"
      ? data.subscription_id
      : isSubscriptionEvent && typeof data.id === "string"
        ? data.id
        : undefined;

  result.paymentId = typeof data.id === "string" ? data.id : undefined;
  result.customerId =
    typeof data.customer_id === "string" ? data.customer_id : undefined;
  result.status = typeof data.status === "string" ? data.status : undefined;
  result.description =
    typeof data.description === "string" ? data.description : undefined;

  if (result.email || result.customerId) {
    result.customer = {
      id: result.customerId,
      email: result.email,
      name:
        typeof data.customer_name === "string" ? data.customer_name : undefined,
    };
  }

  if (!result.plan) {
    result.plan =
      typeof data.product_id === "string" ? data.product_id : undefined;
  }
  if (!result.productId) {
    result.productId = result.plan;
  }

  if (typeof data.created_at === "string") {
    result.createdAt = data.created_at;
  } else if (typeof data.event_time === "string") {
    result.createdAt = data.event_time;
  } else if (typeof data.occurred_at === "string") {
    result.createdAt = data.occurred_at;
  }

  return result;
}

function extractPayPalEventData(
  event: Record<string, unknown>,
  eventType: string
): Partial<ExtractedEventData> {
  if (!event.resource) return {};

  const resource = event.resource as Record<string, unknown>;
  const result: Partial<ExtractedEventData> = {};

  const isSubscriptionEvent = eventType.includes("billing.subscription");
  const isPaymentCaptureEvent = eventType.includes("payment.capture");

  if (isSubscriptionEvent) {
    result.subscriptionId =
      typeof resource.id === "string" ? resource.id : undefined;
    result.paymentId = result.subscriptionId;
  } else if (isPaymentCaptureEvent) {
    result.paymentId =
      typeof resource.id === "string" ? resource.id : undefined;
  } else {
    result.paymentId =
      typeof resource.id === "string" ? resource.id : undefined;
  }

  result.status =
    typeof resource.status === "string" ? resource.status : undefined;
  result.description =
    typeof resource.description === "string" ? resource.description : undefined;

  if (isSubscriptionEvent) {
    result.plan =
      typeof resource.plan_id === "string" ? resource.plan_id : undefined;
    result.productId = result.plan;
  }

  if (isPaymentCaptureEvent && resource.amount) {
    const amountObj = resource.amount as Record<string, unknown>;
    if (typeof amountObj.value === "string") {
      result.amount = parseFloat(amountObj.value);
    } else if (typeof amountObj.value === "number") {
      result.amount = amountObj.value;
    }
    if (typeof amountObj.currency_code === "string") {
      result.currency = amountObj.currency_code.toUpperCase() as CurrencyCode;
    }
  } else if (isSubscriptionEvent && resource.billing_info) {
    const billingInfo = resource.billing_info as Record<string, unknown>;

    if (
      billingInfo.last_payment &&
      typeof billingInfo.last_payment === "object"
    ) {
      const lastPayment = billingInfo.last_payment as Record<string, unknown>;
      if (lastPayment.amount && typeof lastPayment.amount === "object") {
        const lastPaymentAmount = lastPayment.amount as Record<string, unknown>;
        if (typeof lastPaymentAmount.value === "string") {
          result.amount = parseFloat(lastPaymentAmount.value);
        } else if (typeof lastPaymentAmount.value === "number") {
          result.amount = lastPaymentAmount.value;
        }
        if (typeof lastPaymentAmount.currency_code === "string") {
          result.currency =
            lastPaymentAmount.currency_code.toUpperCase() as CurrencyCode;
        }
      }
    }

    if (
      result.amount === undefined &&
      billingInfo.outstanding_balance &&
      typeof billingInfo.outstanding_balance === "object"
    ) {
      const outstandingBalance = billingInfo.outstanding_balance as Record<
        string,
        unknown
      >;
      if (typeof outstandingBalance.value === "string") {
        result.amount = parseFloat(outstandingBalance.value);
      } else if (typeof outstandingBalance.value === "number") {
        result.amount = outstandingBalance.value;
      }
      if (
        !result.currency &&
        typeof outstandingBalance.currency_code === "string"
      ) {
        result.currency =
          outstandingBalance.currency_code.toUpperCase() as CurrencyCode;
      }
    }
  }

  if (result.amount === undefined && resource.amount) {
    const amountObj = resource.amount as Record<string, unknown>;
    if (typeof amountObj.value === "string") {
      result.amount = parseFloat(amountObj.value);
    } else if (typeof amountObj.value === "number") {
      result.amount = amountObj.value;
    }
    if (!result.currency && typeof amountObj.currency_code === "string") {
      result.currency = amountObj.currency_code.toUpperCase() as CurrencyCode;
    }
  }

  if (isPaymentCaptureEvent && resource.payer) {
    const payer = resource.payer as Record<string, unknown>;
    const payerInfo = payer.payer_info as Record<string, unknown>;
    if (payerInfo) {
      if (typeof payerInfo.email === "string") {
        result.email = payerInfo.email;
      }

      let payerName: string | undefined;
      if (
        typeof payerInfo.first_name === "string" &&
        typeof payerInfo.last_name === "string"
      ) {
        payerName = `${payerInfo.first_name} ${payerInfo.last_name}`;
      } else if (typeof payerInfo.first_name === "string") {
        payerName = payerInfo.first_name;
      } else if (typeof payerInfo.last_name === "string") {
        payerName = payerInfo.last_name;
      }

      if (result.email || payerName) {
        result.customer = {
          email: result.email,
          name: payerName,
        };
      }
    }

    if (!result.email && resource.payment_source) {
      const paymentSource = resource.payment_source as Record<string, unknown>;
      if (paymentSource.paypal && typeof paymentSource.paypal === "object") {
        const paypalSource = paymentSource.paypal as Record<string, unknown>;
        if (typeof paypalSource.account_id === "string") {
          result.email = paypalSource.account_id;
          if (!result.customer) result.customer = {};
          result.customer.email = result.email;
        }
      }
    }
  } else if (isSubscriptionEvent && resource.subscriber) {
    const subscriber = resource.subscriber as Record<string, unknown>;

    if (typeof subscriber.email_address === "string") {
      result.email = subscriber.email_address;
    }

    let subscriberName: string | undefined;
    if (subscriber.name && typeof subscriber.name === "object") {
      const name = subscriber.name as Record<string, unknown>;
      const givenName =
        typeof name.given_name === "string" ? name.given_name : undefined;
      const surname =
        typeof name.surname === "string" ? name.surname : undefined;
      if (givenName && surname) {
        subscriberName = `${givenName} ${surname}`;
      } else if (givenName) {
        subscriberName = givenName;
      } else if (surname) {
        subscriberName = surname;
      }
    }

    if (result.email || subscriberName) {
      result.customer = {
        email: result.email,
        name: subscriberName,
      };
    }
  }

  if (!result.email && resource.payer) {
    const payer = resource.payer as Record<string, unknown>;
    const payerInfo = payer.payer_info as Record<string, unknown>;
    if (payerInfo) {
      const payerEmail =
        typeof payerInfo.email === "string" ? payerInfo.email : undefined;
      const payerName =
        typeof payerInfo.first_name === "string" &&
        typeof payerInfo.last_name === "string"
          ? `${payerInfo.first_name} ${payerInfo.last_name}`
          : typeof payerInfo.first_name === "string"
            ? payerInfo.first_name
            : undefined;

      if (payerEmail || payerName) {
        result.customer = {
          email: payerEmail,
          name: payerName,
        };
        result.email = payerEmail;
      }
    }
  }

  if (isSubscriptionEvent) {
    if (typeof resource.start_time === "string") {
      result.createdAt = resource.start_time;
    } else if (typeof resource.status_update_time === "string") {
      result.createdAt = resource.status_update_time;
    } else if (typeof resource.create_time === "string") {
      result.createdAt = resource.create_time;
    } else if (typeof resource.update_time === "string") {
      result.createdAt = resource.update_time;
    }
  } else {
    if (typeof resource.create_time === "string") {
      result.createdAt = resource.create_time;
    } else if (typeof resource.update_time === "string") {
      result.createdAt = resource.update_time;
    }
  }

  return result;
}

function extractPolarEventData(
  event: Record<string, unknown>,
  eventType: string
): Partial<ExtractedEventData> {
  if (!event.data) return {};

  const data = event.data as Record<string, unknown>;
  const result: Partial<ExtractedEventData> = {};

  result.amount =
    typeof data.price_amount === "number"
      ? data.price_amount / 100
      : typeof data.amount === "number"
        ? data.amount / 100
        : undefined;

  result.currency =
    typeof data.price_currency === "string"
      ? (data.price_currency.toUpperCase() as CurrencyCode)
      : typeof data.currency === "string"
        ? (data.currency.toUpperCase() as CurrencyCode)
        : undefined;

  result.email =
    typeof data.customer_email === "string"
      ? data.customer_email
      : typeof (data.customer as { email?: string })?.email === "string"
        ? (data.customer as { email: string }).email
        : undefined;

  result.subscriptionId =
    typeof data.subscription_id === "string"
      ? data.subscription_id
      : typeof data.id === "string" && eventType.includes("subscription")
        ? data.id
        : undefined;

  result.paymentId =
    typeof data.checkout_id === "string"
      ? data.checkout_id
      : typeof data.id === "string" && eventType.includes("checkout")
        ? data.id
        : undefined;

  result.status = typeof data.status === "string" ? data.status : undefined;
  result.description =
    typeof data.description === "string" ? data.description : undefined;

  if (data.customer && typeof data.customer === "object") {
    const customerData = data.customer as Record<string, unknown>;
    result.customerId =
      typeof customerData.id === "string" ? customerData.id : undefined;
    result.customer = {
      id: result.customerId,
      email:
        typeof customerData.email === "string"
          ? customerData.email
          : result.email,
      name:
        typeof customerData.name === "string" ? customerData.name : undefined,
    };
  } else if (result.email) {
    result.customer = { email: result.email };
  }

  result.productId =
    typeof data.product_id === "string" ? data.product_id : undefined;
  result.plan =
    typeof data.price_id === "string" ? data.price_id : result.productId;

  if (typeof data.created_at === "string") {
    result.createdAt = data.created_at;
  } else if (typeof event.created_at === "string") {
    result.createdAt = event.created_at;
  }

  return result;
}

function extractLemonSqueezyEventData(
  event: Record<string, unknown>,
  eventType: string,
  rawEvent: unknown
): Partial<ExtractedEventData> {
  if (!event.data) return {};

  const data = event.data as {
    type?: string;
    id?: string;
    attributes?: Record<string, unknown>;
    relationships?: Record<string, unknown>;
  };

  let attributes = (data.attributes || {}) as Record<string, unknown>;

  if (!attributes || Object.keys(attributes).length === 0) {
    if ((event.data as any).attributes) {
      attributes = (event.data as any).attributes as Record<string, unknown>;
    } else {
      if ((event.data as any).status || (event.data as any).variant_id) {
        attributes = event.data as Record<string, unknown>;
      }
    }
  }

  const result: Partial<ExtractedEventData> = {};
  const isSubscriptionEvent =
    data.type === "subscriptions" || eventType.includes("subscription");
  const rawEventObj = rawEvent as RawEventWithIncluded | null;

  if (isSubscriptionEvent) {
    let firstItem:
      | { unit_price?: number; currency?: string; quantity?: number }
      | undefined;

    if (attributes.first_subscription_item) {
      firstItem = attributes.first_subscription_item as {
        unit_price?: number;
        currency?: string;
        quantity?: number;
      };
    }

    if (firstItem) {
      if (
        firstItem.unit_price !== undefined &&
        typeof firstItem.unit_price === "number"
      ) {
        const quantity =
          typeof firstItem.quantity === "number" && firstItem.quantity > 0
            ? firstItem.quantity
            : 1;
        result.amount = (firstItem.unit_price * quantity) / 100;
      }

      if (typeof firstItem.currency === "string") {
        result.currency = firstItem.currency.toUpperCase() as CurrencyCode;
      }
    } else {
      const relationships = data.relationships as
        | Record<string, { data?: { type?: string; id?: string } }>
        | undefined;
      if (relationships?.first_subscription_item?.data) {
        const itemRef = relationships.first_subscription_item.data;
        if (rawEventObj?.included && itemRef?.id && itemRef?.type) {
          const includedItem = rawEventObj.included.find(
            (inc) => inc.type === itemRef.type && inc.id === itemRef.id
          );
          if (includedItem?.attributes) {
            firstItem = includedItem.attributes as {
              unit_price?: number;
              currency?: string;
              quantity?: number;
            };

            if (
              firstItem.unit_price !== undefined &&
              typeof firstItem.unit_price === "number"
            ) {
              const quantity =
                typeof firstItem.quantity === "number" && firstItem.quantity > 0
                  ? firstItem.quantity
                  : 1;
              result.amount = (firstItem.unit_price * quantity) / 100;
            }

            if (typeof firstItem.currency === "string") {
              result.currency =
                firstItem.currency.toUpperCase() as CurrencyCode;
            }
          }
        }
      }

      if (!result.amount && typeof attributes.unit_price === "number") {
        const quantity =
          typeof attributes.quantity === "number" && attributes.quantity > 0
            ? attributes.quantity
            : 1;
        result.amount = (attributes.unit_price * quantity) / 100;
      }

      if (!result.currency && typeof attributes.currency === "string") {
        result.currency = attributes.currency.toUpperCase() as CurrencyCode;
      }
    }
  } else {
    result.amount =
      typeof attributes.total === "number"
        ? attributes.total / 100
        : typeof attributes.subtotal === "number"
          ? attributes.subtotal / 100
          : undefined;

    result.currency =
      typeof attributes.currency === "string"
        ? (attributes.currency.toUpperCase() as CurrencyCode)
        : undefined;
  }

  result.email =
    typeof attributes.user_email === "string"
      ? attributes.user_email
      : typeof attributes.customer_email === "string"
        ? attributes.customer_email
        : undefined;

  result.subscriptionId =
    data.type === "subscriptions" && typeof data.id === "string"
      ? data.id
      : typeof attributes.subscription_id === "string"
        ? attributes.subscription_id
        : undefined;

  result.paymentId =
    data.type === "orders" && typeof data.id === "string"
      ? data.id
      : typeof attributes.order_id === "string"
        ? String(attributes.order_id)
        : undefined;

  result.customerId =
    typeof attributes.customer_id === "string"
      ? attributes.customer_id
      : undefined;
  result.status =
    typeof attributes.status === "string" ? attributes.status : undefined;
  result.description =
    typeof attributes.notes === "string" ? attributes.notes : undefined;

  if (result.email || result.customerId) {
    result.customer = {
      id: result.customerId,
      email: result.email,
      name:
        typeof attributes.customer_name === "string"
          ? attributes.customer_name
          : undefined,
    };
  }

  result.productId =
    typeof attributes.product_id === "string"
      ? attributes.product_id
      : undefined;
  result.plan =
    typeof attributes.variant_id === "string"
      ? attributes.variant_id
      : result.productId;

  if (typeof attributes.created_at === "string") {
    result.createdAt = attributes.created_at;
  } else if (typeof attributes.updated_at === "string") {
    result.createdAt = attributes.updated_at;
  }

  return result;
}

function extractGenericEventData(
  event: Record<string, unknown>
): Partial<ExtractedEventData> {
  const result: Partial<ExtractedEventData> = {};

  result.amount = typeof event.amount === "number" ? event.amount : undefined;
  result.currency =
    typeof event.currency === "string"
      ? (event.currency.toUpperCase() as CurrencyCode)
      : undefined;
  result.email = typeof event.email === "string" ? event.email : undefined;
  result.subscriptionId =
    typeof event.subscriptionId === "string" ? event.subscriptionId : undefined;
  result.paymentId =
    typeof event.paymentId === "string" ? event.paymentId : undefined;
  result.customerId =
    typeof event.customerId === "string" ? event.customerId : undefined;
  result.status = typeof event.status === "string" ? event.status : undefined;
  result.description =
    typeof event.description === "string" ? event.description : undefined;
  result.plan = typeof event.plan === "string" ? event.plan : undefined;
  result.productId =
    typeof event.productId === "string" ? event.productId : undefined;

  if (event.customer && typeof event.customer === "object") {
    const customerData = event.customer as Record<string, unknown>;
    result.customer = {
      id:
        typeof customerData.id === "string"
          ? customerData.id
          : result.customerId,
      email:
        typeof customerData.email === "string"
          ? customerData.email
          : result.email,
      name:
        typeof customerData.name === "string" ? customerData.name : undefined,
      phone:
        typeof customerData.phone === "string" ? customerData.phone : undefined,
    };
  } else if (result.email || result.customerId) {
    result.customer = { id: result.customerId, email: result.email };
  }

  if (typeof event.createdAt === "string") {
    result.createdAt = event.createdAt;
  } else if (typeof event.created_at === "string") {
    result.createdAt = event.created_at;
  } else if (typeof event.timestamp === "string") {
    result.createdAt = event.timestamp;
  }

  return result;
}

function extractMetadata(
  providerName: Provider,
  event: Record<string, unknown>,
  eventType: string
): Record<string, unknown> | undefined {
  let metadata: Record<string, unknown> | undefined;

  if (providerName === "stripe" && event.data) {
    const eventData = event.data as { object: Record<string, unknown> };
    const data = eventData.object;

    if (
      data.metadata &&
      typeof data.metadata === "object" &&
      data.metadata !== null
    ) {
      metadata = data.metadata as Record<string, unknown>;
    }

    if (!metadata && data.subscription) {
      const subscription =
        typeof data.subscription === "object" && data.subscription !== null
          ? (data.subscription as Record<string, unknown>)
          : null;
      if (
        subscription &&
        subscription.metadata &&
        typeof subscription.metadata === "object" &&
        subscription.metadata !== null
      ) {
        metadata = subscription.metadata as Record<string, unknown>;
      }
    }
  } else if (providerName === "paddle" && event.data) {
    const data = event.data as Record<string, unknown>;

    if (
      data.custom_data &&
      typeof data.custom_data === "object" &&
      data.custom_data !== null
    ) {
      metadata = data.custom_data as Record<string, unknown>;
    }

    if (!metadata && data.subscription) {
      const subscription =
        typeof data.subscription === "object" && data.subscription !== null
          ? (data.subscription as Record<string, unknown>)
          : null;
      if (
        subscription &&
        subscription.custom_data &&
        typeof subscription.custom_data === "object" &&
        subscription.custom_data !== null
      ) {
        metadata = subscription.custom_data as Record<string, unknown>;
      }
    }
  } else if (providerName === "lemonsqueezy") {
    const metadataFromCustomData =
      event.custom_data &&
      typeof event.custom_data === "object" &&
      event.custom_data !== null
        ? (event.custom_data as Record<string, unknown>)
        : undefined;

    let metadataFromAttributes: Record<string, unknown> | undefined;
    if (event.data) {
      const data = event.data as {
        attributes?: Record<string, unknown>;
      };
      const attributes = data.attributes || {};
      if (
        attributes.custom &&
        typeof attributes.custom === "object" &&
        attributes.custom !== null
      ) {
        metadataFromAttributes = attributes.custom as Record<string, unknown>;
      }
    }

    if (metadataFromCustomData || metadataFromAttributes) {
      metadata = {
        ...(metadataFromAttributes || {}),
        ...(metadataFromCustomData || {}),
      };
    }
  } else if (providerName === "polar" && event.data) {
    const data = event.data as Record<string, unknown>;

    if (
      data.metadata &&
      typeof data.metadata === "object" &&
      data.metadata !== null
    ) {
      metadata = data.metadata as Record<string, unknown>;
    }

    if (!metadata && data.checkout) {
      const checkout =
        typeof data.checkout === "object" && data.checkout !== null
          ? (data.checkout as Record<string, unknown>)
          : null;
      if (
        checkout &&
        checkout.metadata &&
        typeof checkout.metadata === "object" &&
        checkout.metadata !== null
      ) {
        metadata = checkout.metadata as Record<string, unknown>;
      }
    }
  } else if (providerName === "paypal") {
    let metadataFromResource: Record<string, unknown> | undefined;

    if (event.resource) {
      const resource = event.resource as Record<string, unknown>;

      if (typeof resource.custom_id === "string") {
        try {
          const parsed = JSON.parse(resource.custom_id);
          if (typeof parsed === "object" && parsed !== null) {
            metadataFromResource = parsed as Record<string, unknown>;
          }
        } catch {
          metadataFromResource = { custom_id: resource.custom_id };
        }
      }

      if (
        resource.custom &&
        typeof resource.custom === "object" &&
        resource.custom !== null
      ) {
        metadataFromResource = {
          ...metadataFromResource,
          ...(resource.custom as Record<string, unknown>),
        };
      }

      if (eventType.includes("payment.capture")) {
        if (
          resource.supplementary_data &&
          typeof resource.supplementary_data === "object"
        ) {
          const supplementaryData = resource.supplementary_data as Record<
            string,
            unknown
          >;
          if (
            supplementaryData.related_ids &&
            typeof supplementaryData.related_ids === "object"
          ) {
            const relatedIds = supplementaryData.related_ids as Record<
              string,
              unknown
            >;
            if (typeof relatedIds.order_id === "string") {
              if (!metadataFromResource) metadataFromResource = {};
              metadataFromResource.order_id = relatedIds.order_id;
            }
          }
        }
      }
    }

    if (metadataFromResource) {
      metadata = metadataFromResource;
    }
  } else {
    if (typeof event.metadata === "object" && event.metadata !== null) {
      metadata = event.metadata as Record<string, unknown>;
    } else if (
      typeof event.custom_data === "object" &&
      event.custom_data !== null
    ) {
      metadata = event.custom_data as Record<string, unknown>;
    }
  }

  return metadata;
}

/**
 * Normalizes a provider-specific webhook event to a PayLayer event
 *
 * @param providerName - The payment provider identifier
 * @param rawEvent - The raw webhook event from the provider
 * @returns Normalized PayLayer event
 */
export function normalizeEvent(
  providerName: Provider,
  rawEvent: unknown,
  env: Record<string, string> = process.env as Record<string, string>
): NormalizedEvent {
  const provider = getProvider(env);
  const providerNormalized = provider.normalizeWebhookEvent(rawEvent);
  const event = providerNormalized as Record<string, unknown>;

  const eventType = String(event.type || "").toLowerCase();

  let type: EventType = "payment.success";
  if (providerName === "stripe") {
    type = mapStripeEventType(eventType);
  } else if (providerName === "paddle") {
    type = mapPaddleEventType(eventType);
  } else if (providerName === "paypal") {
    type = mapPayPalEventType(eventType);
  } else if (providerName === "creem") {
    type = mapCreemEventType(eventType);
  } else if (providerName === "lemonsqueezy") {
    type = mapLemonSqueezyEventType(eventType);
  } else if (providerName === "polar") {
    type = mapPolarEventType(eventType, event);
  } else {
    type = mapGenericEventType(eventType);
  }

  let extractedData: Partial<ExtractedEventData> = {};
  if (providerName === "stripe" && event.data) {
    extractedData = extractStripeEventData(event, eventType);
  } else if (providerName === "paddle" && event.data) {
    extractedData = extractPaddleEventData(event, eventType, rawEvent);
  } else if (providerName === "paypal" && event.resource) {
    extractedData = extractPayPalEventData(event, eventType);
  } else if (providerName === "polar" && event.data) {
    extractedData = extractPolarEventData(event, eventType);
  } else if (providerName === "lemonsqueezy" && event.data) {
    extractedData = extractLemonSqueezyEventData(event, eventType, rawEvent);
  } else {
    extractedData = extractGenericEventData(event);
  }

  const metadata = extractMetadata(providerName, event, eventType) || {};
  metadata._rawEvent = rawEvent;

  return {
    type,
    amount: extractedData.amount,
    currency: extractedData.currency,
    email: extractedData.email,
    provider: providerName,
    subscriptionId: extractedData.subscriptionId,
    paymentId: extractedData.paymentId,
    customerId: extractedData.customerId,
    customer: extractedData.customer,
    status: extractedData.status,
    description: extractedData.description,
    createdAt: extractedData.createdAt,
    plan: extractedData.plan,
    productId: extractedData.productId,
    metadata,
    providerResponse: rawEvent,
  };
}
