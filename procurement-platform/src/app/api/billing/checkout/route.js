import { NextResponse } from "next/server";
import { iyzicoConfig, iyzicoRequest, isIyzicoConfigured, siteUrlFrom } from "@/lib/iyzico";
import { isLicenseActive, isPermanentPlan } from "@/lib/license";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccountUser } from "@/lib/accountCore";

export const dynamic = "force-dynamic";

const clean = (value, max = 120) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);

function normalizeGsm(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("5")) return `+90${digits}`;
  if (digits.length === 11 && digits.startsWith("05")) return `+9${digits}`;
  if (digits.length === 12 && digits.startsWith("905")) return `+${digits}`;
  return null;
}

export async function POST(request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await getAccountUser(supabase);
  if (!user) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (user.isAccountAdmin === false) {
    return NextResponse.json({ error: "Aboneliği yalnız hesap yöneticisi yönetebilir." }, { status: 403 });
  }

  const config = iyzicoConfig();
  const admin = createAdminSupabaseClient();
  if (!isIyzicoConfigured(config) || !admin) {
    return NextResponse.json(
      { error: "Online ödeme henüz yapılandırılmadı. Lütfen daha sonra tekrar deneyin." },
      { status: 503 },
    );
  }

  const { data: license } = await admin
    .from("user_licenses")
    .select("plan_type, license_status, trial_ends_at, subscription_status, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();
  if (isPermanentPlan(license?.plan_type)) {
    return NextResponse.json({ error: "Hesabınızda süresiz lisans var; abonelik gerekmez." }, { status: 409 });
  }
  if (license?.license_status === "suspended") {
    return NextResponse.json({ error: "Hesabınız askıya alınmış; lütfen destek ile iletişime geçin." }, { status: 403 });
  }
  if (license?.subscription_status === "ACTIVE" && isLicenseActive(license)) {
    return NextResponse.json({ error: "Aktif bir aboneliğiniz zaten var." }, { status: 409 });
  }

  const body = await request.json().catch(() => ({}));
  const name = clean(body.name, 60);
  const surname = clean(body.surname, 60);
  const gsmNumber = normalizeGsm(body.phone);
  const identityNumber = String(body.identityNumber || "").replace(/\D/g, "");
  const address = clean(body.address, 250);
  const city = clean(body.city, 60);
  const companyName = clean(body.companyName, 120);

  const missing = [];
  if (!name) missing.push("ad");
  if (!surname) missing.push("soyad");
  if (!gsmNumber) missing.push("geçerli cep telefonu");
  if (identityNumber.length !== 10 && identityNumber.length !== 11) missing.push("TCKN (11 hane) veya VKN (10 hane)");
  if (!address) missing.push("fatura adresi");
  if (!city) missing.push("şehir");
  if (missing.length > 0) {
    return NextResponse.json({ error: `Eksik veya hatalı bilgi: ${missing.join(", ")}.` }, { status: 400 });
  }

  const contactName = companyName || `${name} ${surname}`;
  const billingAddress = { contactName, city, country: "Turkey", address };

  let result;
  try {
    result = await iyzicoRequest(
      "POST",
      "/v2/subscription/checkoutform/initialize",
      {
        locale: "tr",
        conversationId: user.id,
        callbackUrl: `${siteUrlFrom(request)}/api/billing/callback`,
        pricingPlanReferenceCode: config.pricingPlanReferenceCode,
        subscriptionInitialStatus: "ACTIVE",
        customer: {
          name,
          surname,
          email: user.email,
          gsmNumber,
          identityNumber,
          billingAddress,
          shippingAddress: billingAddress,
        },
      },
      config,
    );
  } catch (error) {
    return NextResponse.json(
      { error: `Ödeme formu açılamadı: ${error.message}` },
      { status: 502 },
    );
  }

  const { error: saveError } = await admin.from("billing_checkouts").insert({
    token: result.token,
    user_id: user.id,
    pricing_plan_reference_code: config.pricingPlanReferenceCode,
  });
  if (saveError) {
    return NextResponse.json({ error: "Ödeme oturumu kaydedilemedi." }, { status: 500 });
  }

  return NextResponse.json({ checkoutFormContent: result.checkoutFormContent });
}
