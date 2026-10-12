import { createHmac, timingSafeEqual } from "node:crypto";

// Destek e-postalarının "Yanıtla" adresi talebe ve alıcıya özel, imzalı bir
// adrestir: support+<talep-id><a|c><imza>@<alan-adı>
//   a = adres destek yöneticisine (sana) gönderildi
//   c = adres müşteriye gönderildi
// İmza, adresi gören kişi dışında kimsenin talebe e-postayla mesaj
// ekleyememesini sağlar; "Kimden" satırı tek başına taklit edilebilir.

const TOKEN_LENGTH = 16;

export const REPLY_AUDIENCE = {
  admin: "a",
  customer: "c",
};

function compactTicketId(ticketId) {
  return String(ticketId || "").replaceAll("-", "").toLowerCase();
}

function expandTicketId(compactId) {
  const value = String(compactId || "").toLowerCase();
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function replyToken(secret, compactId, audience) {
  return createHmac("sha256", secret)
    .update(`support-reply:${compactId}:${audience}`)
    .digest("hex")
    .slice(0, TOKEN_LENGTH);
}

export function supportReplySecret() {
  return String(
    process.env.SUPPORT_REPLY_SECRET || process.env.RESEND_WEBHOOK_SECRET || "",
  ).trim();
}

export function buildSupportReplyAddress({ ticketId, audience, receivingDomain, secret }) {
  const domain = String(receivingDomain || "").trim().toLowerCase();
  const compactId = compactTicketId(ticketId);
  if (!domain || !secret || !/^[0-9a-f]{32}$/.test(compactId)) return null;
  if (!Object.values(REPLY_AUDIENCE).includes(audience)) return null;
  return `support+${compactId}${audience}${replyToken(secret, compactId, audience)}@${domain}`;
}

export function parseSupportReplyAddress(recipients, { receivingDomain, secret }) {
  const domain = String(receivingDomain || "").trim().toLowerCase();
  if (!domain || !secret) return null;
  const escapedDomain = domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^support\\+([0-9a-f]{32})([ac])([0-9a-f]{${TOKEN_LENGTH}})@${escapedDomain}$`,
    "i",
  );

  for (const recipient of recipients || []) {
    const address = extractEmailAddress(recipient);
    const match = address.match(pattern);
    if (!match) continue;

    const compactId = match[1].toLowerCase();
    const audience = match[2].toLowerCase();
    const expected = Buffer.from(replyToken(secret, compactId, audience));
    const received = Buffer.from(match[3].toLowerCase());
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      continue;
    }

    return { ticketId: expandTicketId(compactId), audience };
  }

  return null;
}

// "Ad Soyad <kisi@ornek.com>" veya "kisi@ornek.com" → "kisi@ornek.com"
export function extractEmailAddress(value) {
  const raw = String(value || "").trim();
  const bracketed = raw.match(/<([^<>\s]+@[^<>\s]+)>/);
  return (bracketed ? bracketed[1] : raw).trim().toLowerCase();
}

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function buildSupportEmailHtml({
  eventLabel,
  ticket,
  actorLine,
  messageLabel,
  message,
  linkLabel,
  link,
  replyHint,
}) {
  return `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">
      <h2>${escapeHtml(eventLabel)}</h2>
      <p><strong>Konu:</strong> ${escapeHtml(ticket.subject)}</p>
      <p><strong>Kategori:</strong> ${escapeHtml(ticket.category)} &nbsp; <strong>Öncelik:</strong> ${escapeHtml(ticket.priority)}</p>
      ${actorLine || ""}
      <p><strong>${escapeHtml(messageLabel)}:</strong></p>
      <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">${escapeHtml(message)}</div>
      <p><a href="${escapeHtml(link)}">${escapeHtml(linkLabel)}</a></p>
      ${replyHint ? `<p style="color:#64748b;font-size:13px">${escapeHtml(replyHint)}</p>` : ""}
    </div>`;
}

export function supportTicketLink(siteUrl, ticketId) {
  const base = String(siteUrl || "").replace(/\/$/, "");
  return `${base}/dashboard/yardim?ticket=${encodeURIComponent(ticketId)}`;
}
