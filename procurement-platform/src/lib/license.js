export function isLicenseActive(license, now = new Date()) {
  if (!license || license.license_status !== "active") return false;

  const currentTime = now.getTime();
  const planType = String(license.plan_type || "").trim().toLowerCase();

  if (["suresiz", "süresiz", "unlimited", "lifetime", "permanent", "enterprise"].includes(planType)) {
    return true;
  }

  if (planType === "demo") {
    const trialEndsAt = Date.parse(license.trial_ends_at || "");
    return Number.isFinite(trialEndsAt) && trialEndsAt > currentTime;
  }

  if (planType === "active") {
    if (!license.expires_at) return true;
    const expiresAt = Date.parse(license.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > currentTime;
  }

  return false;
}
