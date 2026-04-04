"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function DashboardPage() {
  const [user, setUser] = useState(null);
  const router = useRouter();

  useEffect(() => {
    const getUser = async () => {
      const { data } = await supabase.auth.getUser();

      if (!data?.user) {
        router.push("/login");
        return;
      }

      setUser(data.user);
    };

    getUser();
  }, [router]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (!user) {
    return <p className="p-10">Yükleniyor...</p>;
  }

  const cards = [
    {
      title: "Talepler",
      desc: "Müşteriden veya departmanlardan gelen talepleri yönetin.",
      href: "/dashboard/talepler",
    },
    {
      title: "Teklifler",
      desc: "Tedarikçi tekliflerini toplayın ve karşılaştırın.",
      href: "/dashboard/teklifler",
    },
    {
      title: "Siparişler",
      desc: "Onaylanan tekliflerden sipariş oluşturun.",
      href: "/dashboard/siparisler",
    },
    {
      title: "Raporlar",
      desc: "Satınalma süreçlerini özetleyen raporları görüntüleyin.",
      href: "/dashboard/raporlar",
    },
  ];

  return (
    <main className="min-h-screen bg-slate-100">
      <div className="max-w-6xl mx-auto p-6">
        <div className="bg-white rounded-2xl shadow-sm p-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-slate-800">
              Hoş geldin {user.user_metadata?.full_name || "Kullanıcı"} 👋
            </h1>
            <p className="text-slate-600 mt-2">{user.email}</p>
          </div>

          <button
            onClick={handleLogout}
            className="bg-slate-800 text-white px-5 py-3 rounded-xl hover:bg-slate-700"
          >
            Çıkış Yap
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
          {cards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className="bg-white rounded-2xl shadow-sm p-6 hover:shadow-md transition"
            >
              <h2 className="text-xl font-semibold text-slate-800">
                {card.title}
              </h2>
              <p className="mt-3 text-slate-600">{card.desc}</p>
              <span className="inline-block mt-4 text-sm font-medium text-slate-800">
                Bölüme git →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}