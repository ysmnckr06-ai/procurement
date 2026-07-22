import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";

function inboundConfig() {
  return {
    apiKey: String(process.env.RESEND_RECEIVING_API_KEY || "").trim(),
    webhookSecret: String(process.env.RESEND_WEBHOOK_SECRET || "").trim(),
    receivingDomain: String(process.env.RESEND_RECEIVING_DOMAIN || "")
      .trim()
      .toLowerCase(),
    allowedSender: String(process.env.SUPPORT_NOTIFICATION_EMAIL || "")
      .trim()
      .toLowerCase(),
    adminUserId: String(process.env.SUPPORT_REPLY_ADMIN_USER_ID || "").trim(),
    supabaseUrl: String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

function isConfigured(config) {
  return Object.values(config).every(Boolean);
}

function ticketIdFromRecipients(recipients, receivingDomain) {
  const escapedDomain = receivingDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `^support\\+([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})@${escapedDomain}$`,
    "i",
  );

  for (const recipient of recipients || []) {
    const match = String(recipient || "")
      .trim()
      .match(pattern);
    if (match) return match[1];
  }
  return null;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

function extractNewReply(text, html) {
  const source = String(text || htmlToText(html))
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
  const lines = source.split("\n");
  const replyLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.startsWith(">") ||
      /^On .+wrote:$/i.test(trimmed) ||
      /(?:şunları|şunu|bunları)\s+yazdı\b/i.test(trimmed) ||
      /^(?:iPhone[’']?umdan gönderildi|Sent from my iPhone)$/i.test(trimmed) ||
      /^.+(?:şunu yazdı|yazdı):$/i.test(trimmed) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed) ||
      /^(From|Kimden):\s/i.test(trimmed)
    ) {
      break;
    }
    replyLines.push(line);
  }

  return replyLines.join("\n").trim().slice(0, 20_000);
}

export async function POST(request) {
  const config = inboundConfig();
  if (!isConfigured(config)) {
    return NextResponse.json(
      { error: "Gelen destek e-postası yapılandırılmadı." },
      { status: 503 },
    );
  }

  const webhookId = request.headers.get("svix-id");
  const timestamp = request.headers.get("svix-timestamp");
  const signature = request.headers.get("svix-signature");
  if (!webhookId || !timestamp || !signature) {
    return NextResponse.json(
      { error: "Webhook imza başlıkları eksik." },
      { status: 400 },
    );
  }

  const payload = await request.text();
  const resend = new Resend(config.apiKey);
  let event;
  try {
    event = await resend.webhooks.verify({
      payload,
      headers: { id: webhookId, timestamp, signature },
      webhookSecret: config.webhookSecret,
    });
  } catch {
    return NextResponse.json(
      { error: "Geçersiz webhook imzası." },
      { status: 400 },
    );
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ received: true, ignored: true });
  }

  if (
    String(event.data.from || "")
      .trim()
      .toLowerCase() !== config.allowedSender
  ) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const ticketId = ticketIdFromRecipients(
    event.data.to,
    config.receivingDomain,
  );
  if (!ticketId) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const { data: receivedEmail, error: receivingError } =
    await resend.emails.receiving.get(event.data.email_id);
  if (receivingError || !receivedEmail) {
    return NextResponse.json(
      { error: "E-posta içeriği alınamadı." },
      { status: 502 },
    );
  }

  const reply = extractNewReply(receivedEmail.text, receivedEmail.html);
  if (!reply) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const supabase = createClient(config.supabaseUrl, config.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: messageId, error } = await supabase.rpc(
    "add_support_admin_email_reply",
    {
      p_admin_user_id: config.adminUserId,
      p_message: reply,
      p_provider_email_id: event.data.email_id,
      p_ticket_id: ticketId,
      p_webhook_id: webhookId,
    },
  );

  if (error) {
    return NextResponse.json(
      { error: "E-posta cevabı destek talebine eklenemedi." },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true, messageId });
}
