import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isLicenseActive } from "@/lib/license";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import DashboardShell from "./DashboardShell";

const LICENSE_HEADER = "x-corvian-verified-license";

async function licenseFromProxy() {
  try {
    const value = (await headers()).get(LICENSE_HEADER);
    return value ? JSON.parse(decodeURIComponent(value)) : null;
  } catch {
    return null;
  }
}

export default async function DashboardLayout({ children }) {
  // src/proxy.js oturumu ve lisansı her panel isteğinde doğrular ve sonucu
  // başlıkla iletir; başlık yoksa (beklenmeyen durum) burada yeniden doğrulanır.
  let license = await licenseFromProxy();

  if (!license) {
    const supabase = await createServerSupabaseClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) redirect("/login");

    const { data, error: licenseError } = await supabase
      .from("user_licenses")
      .select("plan_type, license_status, trial_ends_at, expires_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (licenseError) redirect("/abonelik");
    license = data;
  }

  if (!isLicenseActive(license)) redirect("/abonelik");

  return (
    <DashboardShell
      license={license}
      licenseCheckedAt={new Date().toISOString()}
    >
      {children}
    </DashboardShell>
  );
}
