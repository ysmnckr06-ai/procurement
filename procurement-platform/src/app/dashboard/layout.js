import { redirect } from "next/navigation";
import { isLicenseActive } from "@/lib/license";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import DashboardShell from "./DashboardShell";

export default async function DashboardLayout({ children }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: license, error } = await supabase
    .from("user_licenses")
    .select("plan_type, license_status, trial_ends_at, expires_at")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error || !isLicenseActive(license)) redirect("/license-expired");

  return <DashboardShell>{children}</DashboardShell>;
}
