import { NextResponse } from "next/server";
import { Resend } from "resend";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  REPLY_AUDIENCE,
  buildSupportEmailHtml,
  buildSupportReplyAddress,
  escapeHtml,
  supportReplySecret,
  supportTicketLink,
} from "@/lib/supportEmail";

const NOTIFY_WINDOW_MS = 5 * 60 * 1000;

const allowedEvents = new Set([
  "ticket_created",
  "customer_reply",
  "admin_reply",
]);

function notificationConfig() {
  return {
    apiKey: String(process.env.RESEND_API_KEY || "").trim(),
    recipient: String(process.env.SUPPORT_NOTIFICATION_EMAIL || "").trim(),
    from: String(process.env.SUPPORT_FROM_EMAIL || "").trim(),
    receivingDomain: String(process.env.RESEND_RECEIVING_DOMAIN || "").trim(),
  };
}

function isConfigured(config) {
  return Boolean(config.apiKey && config.recipient && config.from);
}

function canSend(config) {
  return Boolean(config.apiKey && config.from);
}

async function authenticatedClient() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

export async function GET() {
  const { user } = await authenticatedClient();
  if (!user)
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });

  return NextResponse.json({ configured: isConfigured(notificationConfig()) });
}

export async function POST(request) {
  const { supabase, user } = await authenticatedClient();
  if (!user)
    return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const event = String(body.event || "");
  const ticketId = String(body.ticketId || "");
  if (!allowedEvents.has(event) || !ticketId) {
    return NextResponse.json(
      { error: "Geçersiz bildirim isteği." },
      { status: 400 },
    );
  }

  const config = notificationConfig();
  if (!canSend(config) || (event !== "admin_reply" && !config.recipient)) {
    return NextResponse.json({ configured: false, sent: false });
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("support_tickets")
    .select(
      "id, subject, category, priority, status, created_by, tenant_id, customer_email, created_at",
    )
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError || !ticket) {
    return NextResponse.json(
      { error: "Destek talebi bulunamadı." },
      { status: 404 },
    );
  }

  const { data: latestMessage } = await supabase
    .from("support_messages")
    .select("id, message, sender_id, sender_role, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestMessage) {
    return NextResponse.json(
      { error: "Destek mesajı bulunamadı." },
      { status: 404 },
    );
  }

  // Bildirim yalnızca yeni yazılmış bir mesaj için gönderilir; aynı uç noktanın
  // tekrar tekrar çağrılıp e-posta yağdırılması engellenir.
  const messageAgeMs = Date.now() - Date.parse(latestMessage.created_at || "");
  if (!Number.isFinite(messageAgeMs) || messageAgeMs > NOTIFY_WINDOW_MS) {
    return NextResponse.json(
      { error: "Bu mesaj için bildirim süresi geçti." },
      { status: 409 },
    );
  }

  if (event === "admin_reply") {
    const { data: admin } = await supabase
      .from("support_admins")
      .select("active")
      .eq("user_id", user.id)
      .eq("active", true)
      .maybeSingle();

    if (
      !admin ||
      latestMessage.sender_role !== "admin" ||
      latestMessage.sender_id !== user.id
    ) {
      return NextResponse.json(
        { error: "Bu bildirim için destek admini yetkisi gerekli." },
        { status: 403 },
      );
    }
  } else if (
    ticket.created_by !== user.id ||
    latestMessage.sender_role !== "customer" ||
    latestMessage.sender_id !== user.id
  ) {
    return NextResponse.json(
      { error: "Bu destek bildirimi için yetkiniz yok." },
      { status: 403 },
    );
  }

  const recipient =
    event === "admin_reply"
      ? String(ticket.customer_email || "").trim()
      : config.recipient;
  if (!recipient) {
    return NextResponse.json({
      configured: true,
      sent: false,
      error: "Müşteri e-posta adresi bulunamadı.",
    });
  }

  const siteUrl = String(
    process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin,
  ).replace(/\/$/, "");
  const eventLabel =
    event === "ticket_created"
      ? "Yeni destek talebi"
      : event === "admin_reply"
        ? "Destek talebiniz yanıtlandı"
        : "Destek talebine yeni yanıt";
  const subject = `[CORVIAN Destek] ${eventLabel}: ${ticket.subject}`;
  const actorLine =
    event === "admin_reply"
      ? "<p>Destek ekibimiz talebinize yeni bir yanıt gönderdi.</p>"
      : `<p><strong>Kullanıcı:</strong> ${escapeHtml(user.email || ticket.created_by)}</p>`;
  const replyTo = buildSupportReplyAddress({
    ticketId: ticket.id,
    audience:
      event === "admin_reply" ? REPLY_AUDIENCE.customer : REPLY_AUDIENCE.admin,
    receivingDomain: config.receivingDomain,
    secret: supportReplySecret(),
  });
  const html = buildSupportEmailHtml({
    eventLabel,
    ticket,
    actorLine,
    messageLabel: event === "admin_reply" ? "Destek yanıtı" : "Mesaj",
    message: latestMessage.message,
    linkLabel:
      event === "admin_reply"
        ? "Yanıtı görüntüle ve cevapla"
        : "Destek Merkezi'nde aç",
    link: supportTicketLink(siteUrl, ticket.id),
    replyHint: replyTo
      ? "Bu e-postayı doğrudan yanıtlayabilirsiniz; cevabınız destek talebine eklenir."
      : "",
  });

  const emailPayload = {
    from: config.from,
    to: [recipient],
    subject,
    html,
  };
  if (replyTo) emailPayload.replyTo = replyTo;

  const resend = new Resend(config.apiKey);
  const { error: resendError } = await resend.emails.send(emailPayload, {
    idempotencyKey: `support-${event}-${latestMessage.id}`,
  });
  if (resendError) {
    return NextResponse.json(
      {
        configured: true,
        sent: false,
        error: "E-posta servisi bildirimi kabul etmedi.",
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ configured: true, sent: true });
}
