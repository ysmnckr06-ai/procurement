import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  REPLY_AUDIENCE,
  buildSupportEmailHtml,
  buildSupportReplyAddress,
  escapeHtml,
  extractEmailAddress,
  parseSupportReplyAddress,
  supportReplySecret,
  supportTicketLink,
} from "@/lib/supportEmail";

function inboundConfig() {
  return {
    apiKey: String(process.env.RESEND_RECEIVING_API_KEY || "").trim(),
    webhookSecret: String(process.env.RESEND_WEBHOOK_SECRET || "").trim(),
    receivingDomain: String(process.env.RESEND_RECEIVING_DOMAIN || "")
      .trim()
      .toLowerCase(),
    allowedSender: extractEmailAddress(process.env.SUPPORT_NOTIFICATION_EMAIL),
    adminUserId: String(process.env.SUPPORT_REPLY_ADMIN_USER_ID || "").trim(),
    supabaseUrl: String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim(),
    serviceRoleKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim(),
  };
}

function isConfigured(config) {
  return Object.values(config).every(Boolean);
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
      /\bwrote:$/i.test(trimmed) ||
      /^-{2,}\s*(?:Özgün İleti|Orijinal Mesaj)\s*-{2,}$/i.test(trimmed) ||
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

  const sender = extractEmailAddress(event.data.from);
  const target = parseSupportReplyAddress(
    [...(event.data.to || []), ...(event.data.received_for || [])],
    { receivingDomain: config.receivingDomain, secret: supportReplySecret() },
  );
  if (!target) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const fromAdmin = target.audience === REPLY_AUDIENCE.admin;
  if (fromAdmin && sender !== config.allowedSender) {
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

  const { data: messageId, error } = fromAdmin
    ? await supabase.rpc("add_support_admin_email_reply", {
        p_admin_user_id: config.adminUserId,
        p_message: reply,
        p_provider_email_id: event.data.email_id,
        p_ticket_id: target.ticketId,
        p_webhook_id: webhookId,
      })
    : await supabase.rpc("add_support_customer_email_reply", {
        p_message: reply,
        p_provider_email_id: event.data.email_id,
        p_sender_email: sender,
        p_ticket_id: target.ticketId,
        p_webhook_id: webhookId,
      });

  if (error) {
    // Müşteri adresi eşleşmezse veya talep kapalıysa tekrar denemenin anlamı yok.
    return NextResponse.json({ received: true, ignored: true });
  }

  const forwarded = await forwardReplyNotification({
    supabase,
    config,
    ticketId: target.ticketId,
    messageId,
    reply,
    fromAdmin,
    sender,
  });

  return NextResponse.json({ received: true, messageId, forwarded });
}

// E-postayla gelen cevabı karşı tarafa iletir: senin cevabın müşteriye,
// müşterinin cevabı sana. Resend idempotency anahtarı, webhook tekrar
// denendiğinde aynı e-postanın iki kez gitmesini engeller.
async function forwardReplyNotification({
  supabase,
  config,
  ticketId,
  messageId,
  reply,
  fromAdmin,
  sender,
}) {
  const sendingKey = String(process.env.RESEND_API_KEY || "").trim();
  const from = String(process.env.SUPPORT_FROM_EMAIL || "").trim();
  if (!sendingKey || !from || !messageId) return false;

  const { data: ticket } = await supabase
    .from("support_tickets")
    .select("id, subject, category, priority, customer_email")
    .eq("id", ticketId)
    .maybeSingle();
  if (!ticket) return false;

  const recipient = fromAdmin
    ? String(ticket.customer_email || "").trim()
    : config.allowedSender;
  if (!recipient) return false;

  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "");
  const eventLabel = fromAdmin
    ? "Destek talebiniz yanıtlandı"
    : "Destek talebine yeni yanıt";
  const replyTo = buildSupportReplyAddress({
    ticketId,
    audience: fromAdmin ? REPLY_AUDIENCE.customer : REPLY_AUDIENCE.admin,
    receivingDomain: config.receivingDomain,
    secret: supportReplySecret(),
  });

  const resend = new Resend(sendingKey);
  const { error } = await resend.emails.send(
    {
      from,
      to: [recipient],
      subject: `[CORVIAN Destek] ${eventLabel}: ${ticket.subject}`,
      html: buildSupportEmailHtml({
        eventLabel,
        ticket,
        actorLine: fromAdmin
          ? "<p>Destek ekibimiz talebinize yeni bir yanıt gönderdi.</p>"
          : `<p><strong>Kullanıcı:</strong> ${escapeHtml(sender)}</p>`,
        messageLabel: fromAdmin ? "Destek yanıtı" : "Mesaj",
        message: reply,
        linkLabel: fromAdmin ? "Yanıtı görüntüle ve cevapla" : "Destek Merkezi'nde aç",
        link: supportTicketLink(siteUrl, ticketId),
        replyHint: replyTo
          ? "Bu e-postayı doğrudan yanıtlayabilirsiniz; cevabınız destek talebine eklenir."
          : "",
      }),
      ...(replyTo ? { replyTo } : {}),
    },
    { idempotencyKey: `support-email-reply-${messageId}` },
  );

  return !error;
}
