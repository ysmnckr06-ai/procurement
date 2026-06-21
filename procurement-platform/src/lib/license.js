export function isLicenseActive(license, now = new Date()) {
  if (!license || license.license_status !== "active") return false;

  const currentTime = now.getTime();

  if (license.plan_type === "demo") {
    const trialEndsAt = Date.parse(license.trial_ends_at || "");
    return Number.isFinite(trialEndsAt) && trialEndsAt > currentTime;
  }

  if (license.plan_type === "active") {
    if (!license.expires_at) return true;
    const expiresAt = Date.parse(license.expires_at);
    return Number.isFinite(expiresAt) && expiresAt > currentTime;
  }

  return false;
}
