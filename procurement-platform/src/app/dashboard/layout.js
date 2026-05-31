"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const menu = [
  { name: "Dashboard", icon: "🏠", href: "/dashboard" },
  { name: "Projeler", icon: "📁", href: "/dashboard/projeler" },
  { name: "Talepler", icon: "📚", href: "/dashboard/talepler" },
  { name: "Teklifler", icon: "📊", href: "/dashboard/teklifler" },
  { name: "Raporlar", icon: "📄", href: "/dashboard/raporlar" },
  { name: "Siparişler", icon: "🛒", href: "/dashboard/siparisler" },
  { name: "Tedarikçiler", icon: "🏢", href: "/dashboard/tedarikciler" },
  { name: "Stok", icon: "📦", href: "/dashboard/stok" },
  { name: "Finans", icon: "₺", href: "/dashboard/finans" },
  { name: "Ayarlar", icon: "⚙️", href: "/dashboard/ayarlar" },
];

export default function DashboardLayout({ children }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-100">
      <aside className="fixed left-0 top-0 z-30 hidden h-screen w-72 border-r border-slate-200 bg-white p-6 lg:block">
        <div className="mb-10 flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-600 text-3xl text-white shadow-lg">
            🛒
          </div>

          <div>
            <div className="text-2xl font-black text-slate-950">Satınalma</div>
            <div className="text-sm font-medium text-slate-500">Yönetim Sistemi</div>
          </div>
        </div>

        <nav className="space-y-2">
          {menu.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center gap-4 rounded-2xl px-5 py-4 text-base font-bold transition ${
                  active
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-200"
                    : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
                }`}
              >
                <span className="text-2xl">{item.icon}</span>
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>
      </aside>

      <main className="min-h-screen lg:pl-72">
        <div className="p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}
