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
  { name: "Finans", icon: "₺", href: "/dashboard/finans" },
  { name: "Ayarlar", icon: "⚙️", href: "/dashboard/ayarlar" },
];

export default function DashboardShell({ children }) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCheckingSession, setIsCheckingSession] = useState(true);

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
                <span className="min-w-0 truncate">{item.name}</span>
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
                  {item.name}
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
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
