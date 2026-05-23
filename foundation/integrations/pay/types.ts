/**
 * Supported currency codes based on ISO 4217 standard.
 * Includes all currencies supported by Stripe, PayPal, Paddle, Lemon Squeezy, and Polar providers.
 */
export enum Currency {
  // Major currencies
  USD = "USD", // United States Dollar
  EUR = "EUR", // Euro
  GBP = "GBP", // British Pound Sterling
  JPY = "JPY", // Japanese Yen
  AUD = "AUD", // Australian Dollar
  CAD = "CAD", // Canadian Dollar
  CHF = "CHF", // Swiss Franc
  CNY = "CNY", // Chinese Yuan
  HKD = "HKD", // Hong Kong Dollar
  NZD = "NZD", // New Zealand Dollar
  SGD = "SGD", // Singapore Dollar
  SEK = "SEK", // Swedish Krona
  NOK = "NOK", // Norwegian Krone
  DKK = "DKK", // Danish Krone
  PLN = "PLN", // Polish Złoty
  CZK = "CZK", // Czech Koruna
  HUF = "HUF", // Hungarian Forint
  BRL = "BRL", // Brazilian Real
  MXN = "MXN", // Mexican Peso
  INR = "INR", // Indian Rupee
  KRW = "KRW", // South Korean Won
  THB = "THB", // Thai Baht
  PHP = "PHP", // Philippine Peso
  MYR = "MYR", // Malaysian Ringgit
  TWD = "TWD", // New Taiwan Dollar
  ILS = "ILS", // Israeli New Shekel
  RUB = "RUB", // Russian Ruble
  ZAR = "ZAR", // South African Rand
  AED = "AED", // UAE Dirham
  ARS = "ARS", // Argentine Peso
  CLP = "CLP", // Chilean Peso
  COP = "COP", // Colombian Peso
  IDR = "IDR", // Indonesian Rupiah
  TRY = "TRY", // Turkish Lira
  VND = "VND", // Vietnamese Dong
  BGN = "BGN", // Bulgarian Lev
  RON = "RON", // Romanian Leu
  HRK = "HRK", // Croatian Kuna
  ISK = "ISK", // Icelandic Króna
  RSD = "RSD", // Serbian Dinar
  UAH = "UAH", // Ukrainian Hryvnia
  KZT = "KZT", // Kazakhstani Tenge
  EGP = "EGP", // Egyptian Pound
  SAR = "SAR", // Saudi Riyal
  QAR = "QAR", // Qatari Riyal
  KWD = "KWD", // Kuwaiti Dinar
  BHD = "BHD", // Bahraini Dinar
  OMR = "OMR", // Omani Rial
  JOD = "JOD", // Jordanian Dinar
  LBP = "LBP", // Lebanese Pound
  PKR = "PKR", // Pakistani Rupee
  BDT = "BDT", // Bangladeshi Taka
  LKR = "LKR", // Sri Lankan Rupee
  NPR = "NPR", // Nepalese Rupee
  MMK = "MMK", // Myanmar Kyat
  KHR = "KHR", // Cambodian Riel
  LAK = "LAK", // Lao Kip
  MNT = "MNT", // Mongolian Tögrög
  BAM = "BAM", // Bosnia and Herzegovina Convertible Mark
  MKD = "MKD", // Macedonian Denar
  ALL = "ALL", // Albanian Lek
  MDL = "MDL", // Moldovan Leu
  GEL = "GEL", // Georgian Lari
  AMD = "AMD", // Armenian Dram
  AZN = "AZN", // Azerbaijani Manat
  BYN = "BYN", // Belarusian Ruble
  UZS = "UZS", // Uzbekistani Som
  TJS = "TJS", // Tajikistani Somoni
  TMT = "TMT", // Turkmenistani Manat
  AFN = "AFN", // Afghan Afghani
  IRR = "IRR", // Iranian Rial
  IQD = "IQD", // Iraqi Dinar
  SYP = "SYP", // Syrian Pound
  YER = "YER", // Yemeni Rial
  NGN = "NGN", // Nigerian Naira
  GHS = "GHS", // Ghanaian Cedi
  KES = "KES", // Kenyan Shilling
  UGX = "UGX", // Ugandan Shilling
  TZS = "TZS", // Tanzanian Shilling
  ETB = "ETB", // Ethiopian Birr
  MAD = "MAD", // Moroccan Dirham
  TND = "TND", // Tunisian Dinar
  DZD = "DZD", // Algerian Dinar
  XOF = "XOF", // West African CFA Franc
  XAF = "XAF", // Central African CFA Franc
  AOA = "AOA", // Angolan Kwanza
  MZN = "MZN", // Mozambican Metical
  MWK = "MWK", // Malawian Kwacha
  ZMW = "ZMW", // Zambian Kwacha
  BWP = "BWP", // Botswana Pula
  SZL = "SZL", // Swazi Lilangeni
  LSL = "LSL", // Lesotho Loti
  NAD = "NAD", // Namibian Dollar
  MGA = "MGA", // Malagasy Ariary
  MUR = "MUR", // Mauritian Rupee
  SCR = "SCR", // Seychellois Rupee
  KMF = "KMF", // Comorian Franc
  DJF = "DJF", // Djiboutian Franc
  ERN = "ERN", // Eritrean Nakfa
  SDG = "SDG", // Sudanese Pound
  SSP = "SSP", // South Sudanese Pound
  BIF = "BIF", // Burundian Franc
  RWF = "RWF", // Rwandan Franc
  CDF = "CDF", // Congolese Franc
  GNF = "GNF", // Guinean Franc
  SLL = "SLL", // Sierra Leonean Leone
  LRD = "LRD", // Liberian Dollar
  GMD = "GMD", // Gambian Dalasi
  PAB = "PAB", // Panamanian Balboa
  CRC = "CRC", // Costa Rican Colón
  GTQ = "GTQ", // Guatemalan Quetzal
  HNL = "HNL", // Honduran Lempira
  NIO = "NIO", // Nicaraguan Córdoba
  DOP = "DOP", // Dominican Peso
  HTG = "HTG", // Haitian Gourde
  JMD = "JMD", // Jamaican Dollar
  BBD = "BBD", // Barbados Dollar
  BZD = "BZD", // Belize Dollar
  BOB = "BOB", // Boliviano
  PYG = "PYG", // Paraguayan Guaraní
  UYU = "UYU", // Uruguayan Peso
  VES = "VES", // Venezuelan Bolívar
  GYD = "GYD", // Guyanese Dollar
  SRD = "SRD", // Surinamese Dollar
  TTD = "TTD", // Trinidad and Tobago Dollar
  XCD = "XCD", // East Caribbean Dollar
  AWG = "AWG", // Aruban Florin
  ANG = "ANG", // Netherlands Antillean Guilder
  BSD = "BSD", // Bahamian Dollar
  BMD = "BMD", // Bermudian Dollar
  KYD = "KYD", // Cayman Islands Dollar
  FJD = "FJD", // Fijian Dollar
  PGK = "PGK", // Papua New Guinean Kina
  SBD = "SBD", // Solomon Islands Dollar
  VUV = "VUV", // Vanuatu Vatu
  WST = "WST", // Samoan Tala
  TOP = "TOP", // Tongan Paʻanga
  XPF = "XPF", // CFP Franc
  PEN = "PEN", // Peruvian Sol
  CUP = "CUP", // Cuban Peso
  CUC = "CUC", // Cuban Convertible Peso
}

/**
 * Type representing all valid currency codes from the Currency enum.
 * This type can be used for type annotations and is backward compatible with string literals.
 */
export type CurrencyCode = `${Currency}`;

export type Provider = string; // Payment provider identifier

export interface ChargeInput {
  amount?: number;
  priceId?: string;
  productId?: string;
  currency: CurrencyCode;
  email?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface ChargeResult {
  id: string;
  status: "pending" | "succeeded" | "failed";
  amount: number;
  currency: CurrencyCode;
  provider: Provider;
  email?: string;
  url?: string;
}

export interface SubscribeInput {
  plan: string;
  currency: CurrencyCode;
  email?: string;
  successUrl?: string;
  cancelUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface SubscriptionResult {
  id: string;
  status: "active" | "paused" | "cancelled" | "past_due";
  plan: string;
  currency: CurrencyCode;
  provider: Provider;
  email?: string;
  url?: string;
}

export interface CheckoutInput {
  amount?: number;
  currency: CurrencyCode;
  email?: string;
  plan?: string; // For subscription checkout
  successUrl?: string;
  cancelUrl?: string;
}

export interface CheckoutResult {
  url: string;
  id: string;
  provider: Provider;
}

export type EventType =
  | "payment.success"
  | "payment.failed"
  | "subscription.created"
  | "subscription.cancelled"
  | "subscription.updated"
  | "subscription.deleted"
  | "subscription.paused"
  | "subscription.resumed";

export interface CustomerInfo {
  id?: string;
  email?: string;
  name?: string;
  phone?: string;
  address?: {
    line1?: string;
    line2?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
}

export interface NormalizedEvent {
  type: EventType;
  amount?: number;
  currency?: CurrencyCode;
  email?: string;
  provider: Provider;
  subscriptionId?: string;
  paymentId?: string;
  customerId?: string;
  customer?: CustomerInfo;
  status?: string;
  description?: string;
  createdAt?: string;
  plan?: string;
  productId?: string;
  metadata?: Record<string, unknown>;
  providerResponse?: unknown;
}

export type EventHandler = (event: NormalizedEvent) => void | Promise<void>;
