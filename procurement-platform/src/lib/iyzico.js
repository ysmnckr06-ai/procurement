import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// iyzico abonelik API'si için sunucu tarafı yardımcıları.
// Bu dosya yalnız API route'larından içe aktarılmalıdır (gizli anahtar içerir).

export const SUBSCRIPTION_GRACE_DAYS = 3;

export function iyzicoConfig() {
  return {
    apiKey: String(process.env.IYZICO_API_KEY || "").trim(),
    secretKey: String(process.env.IYZICO_SECRET_KEY || "").trim(),
    merchantId: String(process.env.IYZICO_MERCHANT_ID || "").trim(),
    baseUrl: String(process.env.IYZICO_BASE_URL || "https://sandbox-api.iyzipay.com")
      .trim()
      .replace(/\/$/, ""),
    pricingPlanReferenceCode: String(process.env.IYZICO_PRICING_PLAN_REFERENCE_CODE || "").trim(),
  };
}

export function isIyzicoConfigured(config = iyzicoConfig()) {
  return Boolean(config.apiKey && config.secretKey && config.baseUrl && config.pricingPlanReferenceCode);
}

// IYZWSv2 kimlik doğrulama başlığı:
// imza = HMAC-SHA256(secretKey, rastgeleAnahtar + uriYolu + istekGövdesi) (hex)
function authorizationHeaders(config, path, bodyText) {
  const randomKey = `${Date.now()}${randomBytes(4).toString("hex")}`;
  const uriPath = path.split("?")[0];
  const signature = createHmac("sha256", config.secretKey)
    .update(randomKey + uriPath + (bodyText || ""))
    .digest("hex");
  const token = Buffer.from(
    `apiKey:${config.apiKey}&randomKey:${randomKey}&signature:${signature}`,
  ).toString("base64");
  return {
    Authorization: `IYZWSv2 ${token}`,
    "x-iyzi-rnd": randomKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

export async function iyzicoRequest(method, path, body, config = iyzicoConfig()) {
  const bodyText = body ? JSON.stringify(body) : "";
  const response = await fetch(`${config.baseUrl}${path}`, {
    method,
    headers: authorizationHeaders(config, path, bodyText),
    body: bodyText || undefined,
    cache: "no-store",
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.status !== "success") {
    const message = data?.errorMessage || `iyzico isteği başarısız (${response.status}).`;
    const error = new Error(message);
    error.code = data?.errorCode || String(response.status);
    throw error;
  }
  return data;
}

// Webhook imzası (X-IYZ-SIGNATURE-V3):
// HMAC-SHA256(secretKey, merchantId + secretKey + eventType +
//   subscriptionReferenceCode + orderReferenceCode + customerReferenceCode) (hex)
export function verifySubscriptionWebhook(payload, signature, config = iyzicoConfig()) {
  if (!config.merchantId || !config.secretKey || !signature) return false;
  const message = [
    config.merchantId,
    config.secretKey,
    payload?.iyziEventType,
    payload?.subscriptionReferenceCode,
    payload?.orderReferenceCode,
    payload?.customerReferenceCode,
  ].map((value) => String(value ?? "")).join("");
  const expected = Buffer.from(
    createHmac("sha256", config.secretKey).update(message).digest("hex"),
  );
  const received = Buffer.from(String(signature).trim().toLowerCase());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// Bir ödeme alındığında erişim bir ay + kısa bir tolerans süresi uzatılır.
// Aynı ödeme için callback ve webhook ikisi de gelebilir; bu yüzden süre
// "şimdi"den hesaplanır ve mevcut bitişten kısa ise güncellenmez.
export function nextPeriodEnd(currentEnd, now = new Date()) {
  const base = new Date(now);
  base.setMonth(base.getMonth() + 1);
  const candidate = new Date(base.getTime() + SUBSCRIPTION_GRACE_DAYS * 86_400_000);
  const existing = Date.parse(currentEnd || "");
  if (Number.isFinite(existing) && existing >= candidate.getTime()) return new Date(existing);
  return candidate;
}

export function siteUrlFrom(request) {
  return String(process.env.NEXT_PUBLIC_SITE_URL || new URL(request.url).origin).replace(/\/$/, "");
}
