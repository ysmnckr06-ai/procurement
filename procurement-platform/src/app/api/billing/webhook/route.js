import { NextResponse } from "next/server";
import { nextPeriodEnd, verifySubscriptionWebhook } from "@/lib/iyzico";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// iyzico her aylık tahsilat denemesinden sonra bildirim gönderir:
//   subscription.order.success → erişim bir ay uzatılır
//   subscription.order.failure → erişim mevcut bitişe kadar sürer, sonra ödeme sayfası
export async function POST(request) {
  const admin = createAdminSupabaseClient();
  if (!admin) return NextResponse.json({ error: "Yapılandırma eksik." }, { status: 503 });

  const payload = await request.json().catch(() => null);
  const signature = request.headers.get("x-iyz-signature-v3");
  if (!payload || !verifySubscriptionWebhook(payload, signature)) {
    return NextResponse.json({ error: "Geçersiz imza." }, { status: 401 });
  }

  const eventType = String(payload.iyziEventType || "");
  const subscriptionRef = String(payload.subscriptionReferenceCode || "");
  const eventKey = String(payload.iyziReferenceCode || `${subscriptionRef}:${payload.orderReferenceCode}:${eventType}`);

  const { data: license } = await admin
    .from("user_licenses")
    .select("user_id, expires_at, subscription_status")
    .eq("subscription_reference_code", subscriptionRef)
    .maybeSingle();

  const { error: duplicateError } = await admin.from("billing_events").insert({
    iyzi_reference_code: eventKey,
    event_type: eventType,
    subscription_reference_code: subscriptionRef || null,
    order_reference_code: payload.orderReferenceCode || null,
    user_id: license?.user_id || null,
    payload,
  });
  // Aynı bildirim daha önce işlendiyse iyzico'ya başarılı dönülür.
  if (duplicateError?.code === "23505") return NextResponse.json({ received: true, duplicate: true });
  if (duplicateError) return NextResponse.json({ error: "Kayıt hatası." }, { status: 500 });

  if (!license) return NextResponse.json({ received: true, ignored: true });

  const now = new Date();
  if (eventType === "subscription.order.success") {
    const periodEnd = nextPeriodEnd(license.expires_at, now);
    await admin
      .from("user_licenses")
      .update({
        plan_type: "active",
        license_status: "active",
        expires_at: periodEnd.toISOString(),
        current_period_end: periodEnd.toISOString(),
        subscription_status: license.subscription_status === "CANCELED" ? "CANCELED" : "ACTIVE",
        last_payment_at: now.toISOString(),
      })
      .eq("user_id", license.user_id);
  } else if (eventType === "subscription.order.failure") {
    await admin
      .from("user_licenses")
      .update({ subscription_status: "UNPAID", last_payment_failed_at: now.toISOString() })
      .eq("user_id", license.user_id);
  }

  return NextResponse.json({ received: true });
}
