import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const allowedEvents = new Set(["ticket_created", "customer_reply"]);

function notificationConfig() {
  return {
    apiKey: String(process.env.RESEND_API_KEY || "").trim(),
    recipient: String(process.env.SUPPORT_NOTIFICATION_EMAIL || "").trim(),
    from: String(process.env.SUPPORT_FROM_EMAIL || "").trim(),
  };
}

function isConfigured(config) {
  return Boolean(config.apiKey && config.recipient && config.from);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  if (!user) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });

  return NextResponse.json({ configured: isConfigured(notificationConfig()) });
}

export async function POST(request) {
  const { supabase, user } = await authenticatedClient();
  if (!user) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const event = String(body.event || "");
  const ticketId = String(body.ticketId || "");
  if (!allowedEvents.has(event) || !ticketId) {
    return NextResponse.json({ error: "Geçersiz bildirim isteği." }, { status: 400 });
  }

  const config = notificationConfig();
  if (!isConfigured(config)) {
    return NextResponse.json({ configured: false, sent: false });
  }

  const { data: ticket, error: ticketError } = await supabase
    .from("support_tickets")
    .select("id, subject, category, priority, status, created_by, tenant_id, created_at")
    .eq("id", ticketId)
    .maybeSingle();

  if (ticketError || !ticket) {
    return NextResponse.json({ error: "Destek talebi bulunamadı." }, { status: 404 });
  }

  const { data: latestMessage } = await supabase
    .from("support_messages")
    .select("message, created_at")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const siteUrl = String(process.env.NEXT_PUBLIC_SITE_URL || request.nextUrl.origin).replace(/\/$/, "");
  const eventLabel = event === "ticket_created" ? "Yeni destek talebi" : "Destek talebine yeni yanıt";
  const subject = `[CORVIAN Destek] ${eventLabel}: ${ticket.subject}`;
  const html = `
    <div style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">
      <h2>${escapeHtml(eventLabel)}</h2>
      <p><strong>Konu:</strong> ${escapeHtml(ticket.subject)}</p>
      <p><strong>Kategori:</strong> ${escapeHtml(ticket.category)} &nbsp; <strong>Öncelik:</strong> ${escapeHtml(ticket.priority)}</p>
      <p><strong>Kullanıcı:</strong> ${escapeHtml(user.email || ticket.created_by)}</p>
      <p><strong>Mesaj:</strong></p>
      <div style="white-space:pre-wrap;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px">${escapeHtml(latestMessage?.message || "-")}</div>
      <p><a href="${escapeHtml(`${siteUrl}/dashboard/yardim`)}">Destek Merkezi'nde aç</a></p>
    </div>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: config.from, to: [config.recipient], subject, html }),
    cache: "no-store",
  });

  if (!response.ok) {
    return NextResponse.json(
      { configured: true, sent: false, error: "E-posta servisi bildirimi kabul etmedi." },
      { status: 502 },
    );
  }

  return NextResponse.json({ configured: true, sent: true });
}
