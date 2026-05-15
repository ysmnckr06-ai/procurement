"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

function StatCard({ icon, title, value, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
            {icon}
          </div>
          <div>
            <div className="text-sm text-slate-500">{title}</div>
            <div className="mt-1 text-3xl font-bold text-slate-900">
              {value}
            </div>
            <div className="text-sm text-slate-500">{text}</div>
          </div>
        </div>
        <span className="text-xl text-slate-400">→</span>
      </div>
    </div>
  );
}

function ModuleCard({ icon, title, text, href, button, tone = "blue" }) {
  const styles = {
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    purple: "bg-purple-50 text-purple-700 border-purple-100",
    green: "bg-green-50 text-green-700 border-green-100",
    orange: "bg-orange-50 text-orange-700 border-orange-100",
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md">
      <div className="flex items-start justify-between gap-5">
        <div>
          <div
            className={`mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl border text-2xl ${styles[tone]}`}
          >
            {icon}
          </div>

          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="mt-3 max-w-md text-sm leading-6 text-slate-600">
            {text}
          </p>

          <Link
            href={href}
            className={`mt-5 inline-flex rounded-xl border px-5 py-3 text-sm font-bold transition-all hover:scale-[1.02] ${styles[tone]}`}
          >
            {button} →
          </Link>
        </div>

        <div className="hidden text-7xl opacity-20 md:block">{icon}</div>
      </div>
    </div>
  );
}

function ActivityEmpty() {
  return (
    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4 text-sm font-medium text-slate-500">
      Henüz aktivite bulunmuyor.
    </div>
  );
}

function Tip({ text, tone }) {
  const styles = {
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    orange: "border-orange-200 bg-orange-50 text-orange-900",
    green: "border-green-200 bg-green-50 text-green-900",
  };

  return (
    <div className={`rounded-xl border p-4 text-sm font-medium ${styles[tone]}`}>
      ✅ {text}
    </div>
  );
}

export default function DashboardPage() {
  const [userEmail, setUserEmail] = useState("");
  const [currentTime, setCurrentTime] = useState("--:--");

  const [stats, setStats] = useState({
    talepler: 0,
    teklifler: 0,
    raporlar: 0,
    siparisler: 0,
  });
  useEffect(() => {
    const updateClock = () => {
      setCurrentTime(
        new Date().toLocaleTimeString("tr-TR", {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
    };

    updateClock();

    const interval = setInterval(updateClock, 1000);

    return () => clearInterval(interval);
    }, []);


  useEffect(() => {
    const loadDashboardStats = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = "/login";
        return;
      }

      setUserEmail(user.email || "");

      const [taleplerRes, tekliflerRes, raporlarRes, siparislerRes] =
        await Promise.all([
          supabase
            .from("requests")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id),

          supabase
            .from("teklifler")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id),

          supabase
            .from("reports")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id),

          supabase
            .from("siparisler")
            .select("*", { count: "exact", head: true })
            .eq("user_id", user.id),
        ]);

      setStats({
        talepler: taleplerRes.count || 0,
        teklifler: tekliflerRes.count || 0,
        raporlar: raporlarRes.count || 0,
        siparisler: siparislerRes.count || 0,
      });
    };

    loadDashboardStats();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.href = "/login";
  };

  return (
    <div className="flex min-h-screen bg-slate-100">

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <section className="relative overflow-hidden rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
            <div className="relative z-10 flex items-start justify-between gap-6">


              <div>
                <h1 className="text-4xl font-bold text-slate-900">
                  Satınalma Yönetim Paneli 👋
                </h1>

                <p className="mt-3 max-w-2xl text-sm text-slate-600">
                  Satınalma süreçlerinizi tek yerden yönetin, teklifleri analiz
                  edin ve en doğru kararları raporlarla destekleyin.
                </p>

                <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Bugün</div>
                    <div className="mt-1 font-bold text-slate-900">
                      {new Date().toLocaleDateString("tr-TR", {
                        day: "2-digit",
                        month: "long",
                        year: "numeric",
                      })}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Saat</div>
                    <div className="mt-1 font-bold text-slate-900">
                      {currentTime}
                    </div>
                  </div>

                  <div className="rounded-2xl bg-slate-50 p-4">
                    <div className="text-sm text-slate-500">Bildirim</div>
                    <div className="mt-1 font-bold text-slate-900">
                      0 yeni bildirim
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="absolute right-12 top-8 hidden text-9xl opacity-10 lg:block">
              📋
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard
              icon="📚"
              title="Toplam Talep Listesi"
              value={stats.talepler}
              text="Aktif talepler"
            />
            <StatCard
              icon="📎"
              title="Toplam Teklif Dosyası"
              value={stats.teklifler}
              text="Yüklenen teklifler"
            />
            <StatCard
              icon="📊"
              title="Oluşturulan Rapor"
              value={stats.raporlar}
              text="Toplam rapor"
            />
            <StatCard
              icon="🛒"
              title="Bekleyen Sipariş"
              value={stats.siparisler}
              text="Onay bekleyen"
            />
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ModuleCard
              icon="📚"
              title="Talepler"
              text="Müşteriden veya departmanlardan gelen talepleri oluşturun, yönetin ve icmal listesine dönüştürün."
              href="/dashboard/talepler"
              button="Talepleri Yönet"
              tone="purple"
            />

            <ModuleCard
              icon="📊"
              title="Teklifler"
              text="Tedarikçi tekliflerini yükleyin, analiz edin ve fiyat, vade, termin gibi kriterlere göre karşılaştırın."
              href="/dashboard/teklifler"
              button="Teklifleri Yönet"
              tone="blue"
            />

            <ModuleCard
              icon="🛒"
              title="Siparişler"
              text="Onaylanan tekliflerden sipariş oluşturun ve tüm satınalma sürecinizi takip edin."
              href="/dashboard/siparisler"
              button="Siparişleri Yönet"
              tone="green"
            />

            <ModuleCard
              icon="📄"
              title="Raporlar"
              text="Satınalma süreçlerinizi özetleyen raporları görüntüleyin, dışa aktarın ve arşivleyin."
              href="/dashboard/raporlar"
              button="Raporları Görüntüle"
              tone="orange"
            />
          </section>

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-bold text-slate-900">
                  Son Aktiviteler
                </h2>
              </div>

              <div className="mt-5 space-y-4">
                <ActivityEmpty />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-bold text-slate-900">Hızlı İpuçları</h2>

              <div className="mt-5 space-y-3">
                <Tip
                  tone="blue"
                  text="Talep listesi oluşturmadan teklif analizi yapabilirsiniz."
                />
                <Tip
                  tone="orange"
                  text="Dövizli teklifler için kur bilgilerini güncel tutmayı unutmayın."
                />
                <Tip
                  tone="green"
                  text="Raporlar sayfasından geçmiş tüm raporlarınıza ulaşabilirsiniz."
                />
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}