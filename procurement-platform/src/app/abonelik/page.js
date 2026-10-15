import Link from "next/link";
import { redirect } from "next/navigation";
import { isLicenseActive, isPermanentPlan } from "@/lib/license";
import { SUBSCRIPTION_GRACE_DAYS } from "@/lib/iyzico";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import SubscriptionPanel, { SignOutButton } from "./SubscriptionPanel";

export const metadata = {
  title: "Abonelik | CORVIAN",
};

export const dynamic = "force-dynamic";

// Erişim bitişi, ödeme tekrar denemeleri için birkaç gün tolerans içerir;
// iyzico'nun bir sonraki çekim günü bu toleranstan önceki tarihtir.
function renewalDate(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return value;
  return new Date(time - SUBSCRIPTION_GRACE_DAYS * 86_400_000).toISOString();
}

function formatDate(value) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time)) return "-";
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "long" }).format(new Date(time));
}

export default async function SubscriptionPage({ searchParams }) {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let { data: license, error: licenseError } = await supabase
    .from("user_licenses")
    .select(
      "plan_type, license_status, trial_ends_at, expires_at, company_name, subscription_status, current_period_end, cancel_at_period_end, last_payment_failed_at",
    )
    .eq("user_id", user.id)
    .maybeSingle();
  // Abonelik sütunları henüz eklenmemişse temel lisans bilgisiyle devam edilir.
  if (licenseError) {
    ({ data: license } = await supabase
      .from("user_licenses")
      .select("plan_type, license_status, trial_ends_at, expires_at, company_name")
      .eq("user_id", user.id)
      .maybeSingle());
  }

  const params = (await searchParams) || {};
  const result = String(params.sonuc || "");
  const active = isLicenseActive(license);
  const permanent = isPermanentPlan(license?.plan_type);
  const subscriptionStatus = String(license?.subscription_status || "");
  const hasSubscription = ["ACTIVE", "UNPAID", "CANCELED"].includes(subscriptionStatus);
  const priceLabel = process.env.NEXT_PUBLIC_SUBSCRIPTION_PRICE_LABEL || "Aylık abonelik";
  const trialEnded = license?.plan_type === "demo" && !active;

  return (
    <main className="min-h-screen bg-slate-950 px-4 py-10 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-blue-300">CORVIAN Business Suite</p>
            <h1 className="mt-2 text-3xl font-black text-white sm:text-4xl">Abonelik</h1>
          </div>
          {active ? (
            <Link href="/dashboard" className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800">
              Panele dön
            </Link>
          ) : (
            <SignOutButton />
          )}
        </div>

        {result === "basarili" && (
          <div className="mb-5 rounded-2xl border border-emerald-300 bg-emerald-50 p-4 text-sm font-semibold text-emerald-900">
            Ödemeniz alındı, aboneliğiniz aktif. Tüm verileriniz yerinde; kaldığınız yerden devam edebilirsiniz.
          </div>
        )}
        {result === "hata" && (
          <div className="mb-5 rounded-2xl border border-red-300 bg-red-50 p-4 text-sm font-semibold text-red-900">
            Ödeme tamamlanamadı. Kartınızdan çekim yapılmadıysa tekrar deneyebilirsiniz.
          </div>
        )}

        <section className="rounded-3xl bg-white p-6 shadow-2xl sm:p-8">
          {license?.license_status === "suspended" ? (
            <div>
              <h2 className="text-xl font-black text-slate-900">Hesabınız askıya alındı</h2>
              <p className="mt-2 text-sm text-slate-600">Verileriniz korunuyor. Lütfen destek ile iletişime geçin.</p>
            </div>
          ) : permanent ? (
            <div>
              <h2 className="text-xl font-black text-slate-900">Süresiz lisans</h2>
              <p className="mt-2 text-sm text-slate-600">Hesabınızda süresiz lisans tanımlı; abonelik gerekmez.</p>
            </div>
          ) : active && !hasSubscription && license?.plan_type !== "demo" ? (
            <div>
              <h2 className="text-xl font-black text-slate-900">Lisansınız aktif</h2>
              <p className="mt-2 text-sm text-slate-600">
                {license?.expires_at
                  ? `Lisansınız ${formatDate(license.expires_at)} tarihine kadar geçerli.`
                  : "Hesabınızda aktif lisans tanımlı; ayrıca abonelik gerekmez."}
              </p>
            </div>
          ) : hasSubscription && active ? (
            <SubscriptionPanel
              mode="manage"
              status={subscriptionStatus}
              periodEnd={formatDate(license?.current_period_end || license?.expires_at)}
              renewalDate={formatDate(renewalDate(license?.current_period_end || license?.expires_at))}
              cancelAtPeriodEnd={Boolean(license?.cancel_at_period_end)}
              paymentFailed={subscriptionStatus === "UNPAID"}
              priceLabel={priceLabel}
            />
          ) : (
            <>
              <div className="rounded-2xl bg-slate-50 p-5">
                {trialEnded ? (
                  <>
                    <h2 className="text-xl font-black text-slate-900">14 günlük deneme süreniz sona erdi</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Verileriniz silinmedi. Abone olduğunuz anda projeleriniz, stoklarınız ve raporlarınızla
                      kaldığınız yerden devam edersiniz.
                    </p>
                  </>
                ) : license?.plan_type === "demo" ? (
                  <>
                    <h2 className="text-xl font-black text-slate-900">Deneme sürümünü kullanıyorsunuz</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Deneme bitişi: <strong>{formatDate(license?.trial_ends_at)}</strong>. Şimdi abone olursanız
                      deneme sonunda kesinti yaşamazsınız.
                    </p>
                  </>
                ) : (
                  <>
                    <h2 className="text-xl font-black text-slate-900">Aboneliğiniz aktif değil</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      Verileriniz korunuyor. Abone olarak kaldığınız yerden devam edebilirsiniz.
                    </p>
                  </>
                )}
                <div className="mt-4 flex flex-wrap items-baseline gap-2">
                  <span className="text-2xl font-black text-slate-900">{priceLabel}</span>
                  <span className="text-sm font-semibold text-slate-500">· Her ay otomatik yenilenir · İstediğiniz zaman iptal</span>
                </div>
                <ul className="mt-4 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
                  <li>✓ Sınırsız proje, talep ve teklif mukayesesi</li>
                  <li>✓ Stok, sipariş, teslim alma ve finans takibi</li>
                  <li>✓ PDF / Excel raporlar ve belge arşivi</li>
                  <li>✓ Destek merkezi</li>
                </ul>
              </div>
              <SubscriptionPanel
                mode="checkout"
                defaultCompanyName={license?.company_name || ""}
                email={user.email}
              />
            </>
          )}
        </section>

        <p className="mt-6 text-center text-xs text-slate-400">
          Ödemeler iyzico güvencesiyle alınır; kart bilgileriniz CORVIAN sunucularında saklanmaz.
        </p>
      </div>
    </main>
  );
}
