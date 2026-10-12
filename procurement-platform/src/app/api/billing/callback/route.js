import { NextResponse } from "next/server";
import { iyzicoRequest, nextPeriodEnd, siteUrlFrom } from "@/lib/iyzico";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

// iyzico ödeme formu tamamlandığında bu adrese "token" alanıyla POST eder.
// Sonuç token ile iyzico'dan tekrar sorgulanır; formdan gelen veriye güvenilmez.
export async function POST(request) {
  const siteUrl = siteUrlFrom(request);
  const redirect = (status) =>
    NextResponse.redirect(`${siteUrl}/abonelik?sonuc=${status}`, { status: 303 });

  const form = await request.formData().catch(() => null);
  const token = String(form?.get("token") || "").trim();
  const admin = createAdminSupabaseClient();
  if (!token || !admin) return redirect("hata");

  const { data: checkout } = await admin
    .from("billing_checkouts")
    .select("token, user_id, completed_at")
    .eq("token", token)
    .maybeSingle();
  if (!checkout) return redirect("hata");
  if (checkout.completed_at) return redirect("basarili");

  let result;
  try {
    result = await iyzicoRequest("GET", `/v2/subscription/checkoutform/${encodeURIComponent(token)}`);
  } catch {
    await admin.from("billing_checkouts").update({ result_status: "retrieve_failed" }).eq("token", token);
    return redirect("hata");
  }

  const data = result.data || {};
  const status = String(data.subscriptionStatus || "").toUpperCase();
  if (status !== "ACTIVE" || !data.referenceCode) {
    await admin.from("billing_checkouts").update({ result_status: status || "unknown" }).eq("token", token);
    return redirect("hata");
  }

  const { data: license } = await admin
    .from("user_licenses")
    .select("expires_at, subscription_reference_code")
    .eq("user_id", checkout.user_id)
    .maybeSingle();

  const now = new Date();
  const periodEnd = nextPeriodEnd(
    license?.subscription_reference_code === data.referenceCode ? license?.expires_at : null,
    now,
  );

  const { error } = await admin
    .from("user_licenses")
    .update({
      plan_type: "active",
      license_status: "active",
      activated_at: now.toISOString(),
      expires_at: periodEnd.toISOString(),
      current_period_end: periodEnd.toISOString(),
      billing_provider: "iyzico",
      subscription_reference_code: data.referenceCode,
      customer_reference_code: data.customerReferenceCode || null,
      subscription_status: "ACTIVE",
      cancel_at_period_end: false,
      last_payment_at: now.toISOString(),
    })
    .eq("user_id", checkout.user_id);

  if (error) return redirect("hata");

  // Ödemesi alınamayan eski abonelik varsa iyzico'nun tekrar çekim denemesin diye iptal edilir.
  const previousRef = license?.subscription_reference_code;
  if (previousRef && previousRef !== data.referenceCode) {
    await iyzicoRequest(
      "POST",
      `/v2/subscription/subscriptions/${encodeURIComponent(previousRef)}/cancel`,
      { subscriptionReferenceCode: previousRef },
    ).catch(() => {});
  }

  await admin
    .from("billing_checkouts")
    .update({ completed_at: now.toISOString(), result_status: "ACTIVE" })
    .eq("token", token);

  return redirect("basarili");
}
