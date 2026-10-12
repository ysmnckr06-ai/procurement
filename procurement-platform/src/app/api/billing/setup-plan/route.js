import { NextResponse } from "next/server";
import { iyzicoConfig, iyzicoRequest } from "@/lib/iyzico";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Tek seferlik kurulum: iyzico'da abonelik ürünü ve aylık ödeme planı oluşturur,
// plan referans kodunu döndürür. Bu kod Vercel'de
// IYZICO_PRICING_PLAN_REFERENCE_CODE olarak kaydedilir. Yalnız destek
// yöneticisi çağırabilir; gizli anahtarlar sunucudan çıkmaz.
export async function POST(request) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });

  const { data: isAdmin } = await supabase.rpc("is_support_admin");
  if (isAdmin !== true) return NextResponse.json({ error: "Yetkiniz yok." }, { status: 403 });

  const config = iyzicoConfig();
  if (!config.apiKey || !config.secretKey) {
    return NextResponse.json({ error: "IYZICO_API_KEY ve IYZICO_SECRET_KEY tanımlı değil." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const price = Number(body.price);
  if (!Number.isFinite(price) || price <= 0) {
    return NextResponse.json({ error: "Geçerli bir aylık fiyat girin." }, { status: 400 });
  }

  try {
    const product = await iyzicoRequest(
      "POST",
      "/v2/subscription/products",
      { locale: "tr", name: "CORVIAN Business Suite", description: "CORVIAN aylık abonelik" },
      config,
    );
    const productReferenceCode = product.data?.referenceCode;
    const plan = await iyzicoRequest(
      "POST",
      `/v2/subscription/products/${encodeURIComponent(productReferenceCode)}/pricing-plans`,
      {
        locale: "tr",
        name: "Aylık",
        price,
        currencyCode: "TRY",
        paymentInterval: "MONTHLY",
        paymentIntervalCount: 1,
        planPaymentType: "RECURRING",
      },
      config,
    );
    return NextResponse.json({
      baseUrl: config.baseUrl,
      productReferenceCode,
      pricingPlanReferenceCode: plan.data?.referenceCode,
    });
  } catch (error) {
    return NextResponse.json({ error: `iyzico: ${error.message}`, code: error.code }, { status: 502 });
  }
}
