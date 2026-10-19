import { NextResponse } from "next/server";
import { iyzicoRequest } from "@/lib/iyzico";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getAccountUser } from "@/lib/accountCore";

export const dynamic = "force-dynamic";

// Abonelik iptal edilir; ödenmiş dönemin sonuna kadar erişim sürer,
// veriler silinmez. Kullanıcı istediği zaman yeniden abone olabilir.
export async function POST() {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await getAccountUser(supabase);
  if (!user) return NextResponse.json({ error: "Oturum gerekli." }, { status: 401 });
  if (user.isAccountAdmin === false) {
    return NextResponse.json({ error: "Aboneliği yalnız hesap yöneticisi yönetebilir." }, { status: 403 });
  }

  const admin = createAdminSupabaseClient();
  if (!admin) return NextResponse.json({ error: "Yapılandırma eksik." }, { status: 503 });

  const { data: license } = await admin
    .from("user_licenses")
    .select("subscription_reference_code, subscription_status")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!license?.subscription_reference_code || license.subscription_status === "CANCELED") {
    return NextResponse.json({ error: "İptal edilecek aktif abonelik yok." }, { status: 400 });
  }

  try {
    await iyzicoRequest(
      "POST",
      `/v2/subscription/subscriptions/${encodeURIComponent(license.subscription_reference_code)}/cancel`,
      { subscriptionReferenceCode: license.subscription_reference_code },
    );
  } catch (error) {
    return NextResponse.json({ error: `Abonelik iptal edilemedi: ${error.message}` }, { status: 502 });
  }

  await admin
    .from("user_licenses")
    .update({ subscription_status: "CANCELED", cancel_at_period_end: true })
    .eq("user_id", user.id);

  return NextResponse.json({ canceled: true });
}
