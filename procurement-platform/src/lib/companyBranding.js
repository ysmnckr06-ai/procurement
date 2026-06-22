export const DEFAULT_COMPANY_NAME = "Firma adı belirtilmedi";
export const CORVIAN_PRODUCT_NAME = "Corvian ERP";

function cleanCompanyName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function resolveCompanyName({ settings, user, license } = {}) {
  return (
    cleanCompanyName(settings?.company_name) ||
    cleanCompanyName(user?.user_metadata?.company_name) ||
    cleanCompanyName(license?.company_name) ||
    DEFAULT_COMPANY_NAME
  );
}

export function companyBrandLine(companyName) {
  return `${cleanCompanyName(companyName) || DEFAULT_COMPANY_NAME} · ${CORVIAN_PRODUCT_NAME}`;
}

export async function fetchCompanyBranding(supabase, suppliedUser = null) {
  let user = suppliedUser;
  if (!user) {
    const { data } = await supabase.auth.getUser();
    user = data?.user || null;
  }

  if (!user?.id) {
    return { companyName: DEFAULT_COMPANY_NAME, brandLine: companyBrandLine(DEFAULT_COMPANY_NAME) };
  }

  const [settingsResult, licenseResult] = await Promise.all([
    supabase
      .from("company_settings")
      .select("company_name")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("user_licenses")
      .select("company_name")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
  ]);

  const companyName = resolveCompanyName({
    settings: settingsResult.data,
    user,
    license: licenseResult.data,
  });

  return { companyName, brandLine: companyBrandLine(companyName) };
}
