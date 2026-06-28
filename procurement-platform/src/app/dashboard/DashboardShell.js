"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

const appTitle = "CORVIAN Business Suite";

const menu = [
  { name: "Genel Bakış", icon: "🏠", href: "/dashboard" },
  { name: "Projeler", icon: "📁", href: "/dashboard/projeler" },
  { name: "Talepler", icon: "📚", href: "/dashboard/talepler" },
  { name: "Teklifler", icon: "📊", href: "/dashboard/teklifler" },
  { name: "Raporlar", icon: "📄", href: "/dashboard/raporlar" },
  { name: "Siparişler", icon: "🛒", href: "/dashboard/siparisler" },
  { name: "İş Ortakları", icon: "🤝", href: "/dashboard/tedarikciler" },
  { name: "Stok", icon: "📦", href: "/dashboard/stok" },
  { name: "AI Asistan", icon: "AI", href: "/dashboard/ai-asistan" },
  { name: "Finans", icon: "₺", href: "/dashboard/finans" },
  { name: "Yardım", icon: "?", href: "/dashboard/yardim" },
  { name: "Ayarlar", icon: "⚙️", href: "/dashboard/ayarlar" },
];

function getMenuLabel(item) {
  return item.href === "/dashboard/yardim" ? "Destek Merkezi" : item.name;
}

const dateFormatter = new Intl.DateTimeFormat("tr-TR", {
  dateStyle: "long",
  timeZone: "Europe/Istanbul",
});

function formatLicenseDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime())
    ? "Tarih belirtilmemiş"
    : dateFormatter.format(date);
}

function LicenseStatusCard({ license, licenseCheckedAt }) {
  if (license?.license_status === "suspended") {
    return (
      <section className="mb-5 flex flex-col gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-black text-red-800">
            Lisans askıya alındı
          </div>
          <div className="mt-1 text-xs font-semibold text-red-600">
            Kullanıma devam etmek için lisans yöneticinizle iletişime geçin.
          </div>
        </div>
        <span className="w-fit rounded-full bg-red-100 px-3 py-1 text-xs font-black text-red-700">
          Askıda
        </span>
      </section>
    );
  }

  if (license?.plan_type === "demo") {
    const trialEndsAt = Date.parse(license.trial_ends_at || "");
    const checkedAt = Date.parse(licenseCheckedAt || "");
    const remainingDays =
      Number.isFinite(trialEndsAt) && Number.isFinite(checkedAt)
        ? Math.max(Math.ceil((trialEndsAt - checkedAt) / 86_400_000), 0)
        : 0;

    return (
      <section className="mb-5 flex flex-col gap-2 rounded-2xl border border-amber-200 bg-gradient-to-r from-amber-50 to-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-black text-slate-900">Demo sürümü</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            Demo bitiş tarihi: {formatLicenseDate(license.trial_ends_at)}
          </div>
        </div>
        <span className="w-fit rounded-full bg-amber-100 px-3 py-1 text-xs font-black text-amber-800">
          {remainingDays} gün kaldı
        </span>
      </section>
    );
  }

  if (license?.plan_type === "active") {
    return (
      <section className="mb-5 flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-gradient-to-r from-emerald-50 to-white px-4 py-3 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-sm font-black text-slate-900">Aktif lisans</div>
          <div className="mt-1 text-xs font-semibold text-slate-500">
            {license.expires_at
              ? `Bitiş tarihi: ${formatLicenseDate(license.expires_at)}`
              : "Süresiz kullanım"}
          </div>
        </div>
        <span className="w-fit rounded-full bg-emerald-100 px-3 py-1 text-xs font-black text-emerald-800">
          {license.expires_at
            ? formatLicenseDate(license.expires_at)
            : "Süresiz"}
        </span>
      </section>
    );
  }

  return null;
}

export default function DashboardShell({
  children,
  license,
  licenseCheckedAt,
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);
  const [supportUnreadCount, setSupportUnreadCount] = useState(0);

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.replace("/login");
  }

  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!mounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      try {
        const { data: adminRow } = await supabase
          .from("support_admins")
          .select("active")
          .eq("user_id", user.id)
          .eq("active", true)
          .maybeSingle();

        const unreadColumn = adminRow?.active
          ? "unread_for_admin"
          : "unread_for_customer";

        let unreadQuery = supabase
          .from("support_tickets")
          .select("id", { count: "exact", head: true })
          .gt(unreadColumn, 0);

        if (!adminRow?.active) {
          unreadQuery = unreadQuery.eq("tenant_id", user.id);
        }

        const { count } = await unreadQuery;
        if (mounted) setSupportUnreadCount(count || 0);
      } catch {
        if (mounted) setSupportUnreadCount(0);
      }

      setIsCheckingSession(false);
    }

    checkSession();

    return () => {
      mounted = false;
    };
  }, [router]);

  if (isCheckingSession) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-sm font-bold text-slate-700 shadow-sm">
          Oturum kontrol ediliyor...
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-72 flex-col border-r border-slate-200 bg-white p-6 lg:flex">
        <div className="mb-8 flex shrink-0 items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-3xl text-white shadow-lg">
            🛒
          </div>

          <div className="min-w-0">
            <div className="text-xl font-black leading-tight text-slate-950">
              CORVIAN
            </div>
            <div className="text-sm font-medium text-slate-500">
              Business Suite
            </div>
          </div>
        </div>

        <nav className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-2">
          {menu.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex min-w-0 items-center gap-4 rounded-2xl px-5 py-4 text-base font-bold transition ${
                  active
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                }`}
              >
                <span className="shrink-0 text-2xl">{item.icon}</span>
                <span className="min-w-0 flex-1 truncate">{getMenuLabel(item)}</span>
                {item.href === "/dashboard/yardim" && supportUnreadCount > 0 && (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-black ${
                      active ? "bg-white text-blue-700" : "bg-red-600 text-white"
                    }`}
                  >
                    {supportUnreadCount}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <button
          type="button"
          onClick={handleSignOut}
          className="mt-6 flex w-full shrink-0 items-center gap-4 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 text-base font-black text-red-700 transition hover:bg-red-100"
        >
          <span className="text-2xl">🚪</span>
          <span>Çıkış Yap</span>
        </button>
      </aside>

      <main className="min-h-screen lg:pl-72">
        <div className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:hidden">
          <div className="mb-3 flex items-center justify-between">
            <div className="min-w-0">
              <div className="truncate text-lg font-black text-slate-950">
                {appTitle}
              </div>
              <div className="text-xs font-semibold text-slate-500">
                Canlı operasyon ekranı
              </div>
            </div>
            <div className="ml-3 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-600 text-xl text-white">
              🛒
            </div>
          </div>
          <nav className="flex gap-2 overflow-x-auto pb-1">
            {menu.map((item) => {
              const active =
                item.href === "/dashboard"
                  ? pathname === "/dashboard"
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold ${
                    active
                      ? "bg-blue-600 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {getMenuLabel(item)}
                  {item.href === "/dashboard/yardim" && supportUnreadCount > 0 && (
                    <span
                      className={`ml-2 rounded-full px-2 py-0.5 text-xs font-black ${
                        active ? "bg-white text-blue-700" : "bg-red-600 text-white"
                      }`}
                    >
                      {supportUnreadCount}
                    </span>
                  )}
                </Link>
              );
            })}
            <button
              type="button"
              onClick={handleSignOut}
              className="shrink-0 rounded-full bg-red-50 px-4 py-2 text-sm font-bold text-red-700"
            >
              Çıkış
            </button>
          </nav>
        </div>
        <div className="p-4 sm:p-6 lg:p-8">
          <LicenseStatusCard
            license={license}
            licenseCheckedAt={licenseCheckedAt}
          />
          {children}
        </div>
      </main>
    </div>
  );
}
