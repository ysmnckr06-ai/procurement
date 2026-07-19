"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";


export default function RaporlarPage() {
  const router = useRouter();
  const [raporlar, setRaporlar] = useState([]);
  const [arama, setArama] = useState("");
  const [durumFiltre, setDurumFiltre] = useState("Tümü");

useEffect(() => {
  const loadReports = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push("/login");
        return;
      }

      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) {
        console.error(error);
        return;
      }

      setRaporlar(data || []);

    } catch (err) {
      console.error(err);
    }
  };

  loadReports();
}, [router]);

const getReportName = useCallback((rapor) => {
  const sourceItem = Array.isArray(rapor.items) ? rapor.items[0] : null;
  if (rapor.source_request_number) {
    return rapor.source_request_number;
  }
  if (sourceItem?.sourceRequestNumber) {
    return sourceItem.sourceRequestNumber;
  }
  const name =
    rapor.ad ||
    rapor.name ||
    rapor.file_name ||
    rapor.report_name ||
    rapor.title ||
    rapor.request_name ||
    rapor.talep_adi ||
    "";

  if (
    !name ||
    name === "undefined" ||
    name.trim() === ""
  ) {
    return "Karşılaştırma Raporu";
  }

  return String(name)
    .replace(/\.(xlsx?|pdf|png|jpe?g)$/i, "")
    .replace(/satın\s*alma\s*gerekenler/gi, "Talep Mukayesesi");
}, []);

const getReportFirma = useCallback((rapor) => {
  return (
    rapor.onerilenFirma ||
    rapor.onerilenfirma ||
    rapor.recommended_firm ||
    rapor.recommendedFirm ||
    rapor.firma ||
    rapor.company ||
    "-"
  );
}, []);

function getReportPath(rapor) {
  return rapor.reportpath || rapor.report_path || rapor.reportPath || "";
}

async function downloadReport(rapor) {
  const path = getReportPath(rapor);

  if (!path) {
    alert("Rapor dosyası bulunamadı.");
    return;
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const token = session?.access_token;

  if (!token) {
    alert("Oturum bulunamadı. Lütfen tekrar giriş yapın.");
    return;
  }

  const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    alert("Rapor indirilemedi.");
    return;
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "mukayese_raporu.xlsx";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

  const filtreliRaporlar = useMemo(() => {
    return raporlar.filter((rapor) => {
      const ad = String(getReportName(rapor)).toLowerCase();
      const firma = String(getReportFirma(rapor)).toLowerCase();
      const aramaLower = arama.toLowerCase();

      const aramaUyum = ad.includes(aramaLower) || firma.includes(aramaLower);
      const durumUyum =
        durumFiltre === "Tümü" ? true : rapor.durum === durumFiltre;

      return aramaUyum && durumUyum;
    });
  }, [raporlar, arama, durumFiltre, getReportName, getReportFirma]);

  const durumRenkleri = {
    tamamlandi: { arkaPlan: "#DCFCE7", yazi: "#166534" },
    bekliyor: { arkaPlan: "#FEF3C7", yazi: "#92400E" },
    gecikmis: { arkaPlan: "#FEE2E2", yazi: "#991B1B" },
  };

  function getDurumRengi(durum) {
    if (durum === "Tamamlandı") {
      return durumRenkleri.tamamlandi;
    }

    if (durum === "Gecikmiş") {
      return durumRenkleri.gecikmis;
    }

    return durumRenkleri.bekliyor;
  }

async function deleteReport(reportId) {
  const onay = window.confirm("Bu raporu silmek istediğine emin misin?");
  if (!onay) return;


  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    alert("Kullanıcı bulunamadı.");
    return;
  }

  const { error } = await supabase
    .from("reports")
    .delete()
    .eq("id", reportId)
    .eq("user_id", user.id);

  if (error) {
    console.error("Rapor silme hatası:", error);
    alert(`Rapor silinemedi: ${error.message}`);
    return;
  }

  setRaporlar((prev) => prev.filter((r) => r.id !== reportId));

  alert("Rapor silindi.");
}

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "32px" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div style={{ marginBottom: "24px" }}>
<div className="rounded-3xl bg-gradient-to-r from-slate-900 via-slate-800 to-blue-900 p-8 text-white shadow-xl">
  <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
    <div>
      <div className="mb-3 inline-flex rounded-full bg-white/10 px-4 py-2 text-sm font-semibold text-blue-100">
        Procurement AI - Rapor Merkezi
      </div>

      <h1 className="text-4xl font-black tracking-tight">
        Satınalma Raporları
      </h1>

      <p className="mt-3 max-w-2xl text-sm text-slate-200">
        Teklif analizlerini inceleyin, en uygun firmaları değerlendirin
        ve sipariş süreçlerini yönetin.
      </p>
    </div>

    <div className="grid grid-cols-2 gap-4">
      <MiniCard
        title="Toplam Rapor"
        value={raporlar.length}
      />

      <MiniCard
        title="Siparişe Dönüşen"
        value={
          raporlar.filter((r) => r.durum === "Tamamlandı").length
        }
      />
    </div>
  </div>
</div>
          <p style={{ marginTop: "8px", color: "#6b7280", fontSize: "15px" }}>
            Oluşturulan raporları görüntüleyin, filtreleyin ve yönetin.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px", marginBottom: "24px" }}>
          <StatCard title="Toplam Rapor" value={raporlar.length} color="#111827" />
          <StatCard title="Tamamlanan" value={raporlar.filter((r) => r.durum === "Tamamlandı").length} color="#166534" />
          <StatCard title="Bekleyen" value={raporlar.filter((r) => r.durum === "Bekliyor").length} color="#92400E" />
          <StatCard title="Gecikmiş" value={raporlar.filter((r) => r.durum === "Gecikmiş").length} color="#991B1B" />
        </div>
    
        <div style={{ background: "#ffffff", borderRadius: "16px", padding: "18px", boxShadow: "0 10px 25px rgba(0,0,0,0.06)", marginBottom: "20px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Rapor veya firma ara..."
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            style={{ flex: "1", minWidth: "240px", padding: "12px 14px", border: "1px solid #d1d5db", borderRadius: "12px", fontSize: "14px", outline: "none" }}
          />

          <select
            value={durumFiltre}
            onChange={(e) => setDurumFiltre(e.target.value)}
            style={{ padding: "12px 14px", border: "1px solid #d1d5db", borderRadius: "12px", fontSize: "14px", background: "#fff" }}
          >
            <option>Tümü</option>
            <option>Tamamlandı</option>
            <option>Bekliyor</option>
            <option>Gecikmiş</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: "16px" }}>
          {filtreliRaporlar.length === 0 && (
            <div style={{ background: "#fff", borderRadius: "18px", padding: "20px", color: "#6b7280" }}>
              Henüz rapor yok.
            </div>
          )}

          {filtreliRaporlar.map((rapor, index) => {
            const renk = getDurumRengi(rapor.durum);

            return (
              <div
                key={rapor.id}
                style={{
                  background: "#fff",
                  borderRadius: "18px",
                  cursor: "pointer",
                  transition: "0.2s",
                }}
              >
              
                <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: "20px", fontWeight: "700", color: "#111827", marginBottom: "8px" }}>
                      {index + 1}. {getReportName(rapor)}
                    </div>

                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", fontSize: "14px", color: "#6b7280" }}>
                      <span>
                          Tarih: {rapor.created_at ? new Date(rapor.created_at).toLocaleString("tr-TR") : rapor.tarih || "-"}
                      </span>
                      <span>Tür: {rapor.tur || rapor.type || "Mukayese"}</span>
                      <span>Firma: {getReportFirma(rapor)}</span>
                    </div>
                  </div>

                  <div style={{ background: renk.arkaPlan, color: renk.yazi, padding: "8px 14px", borderRadius: "999px", fontWeight: "700", fontSize: "13px" }}>
                    {rapor.durum}
                  </div>
                </div>

                <div style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      downloadReport(rapor);
                    }}
                    style={{ background: "#2563eb", color: "#fff", border: "none", borderRadius: "10px", padding: "10px 14px", fontWeight: "600", cursor: "pointer" }}
                  >
                    Raporu Indir
                  </button>
                  <Link
                    href={`/dashboard/raporlar/${rapor.id}`}
                    onClick={(e) => e.stopPropagation()}
                    style={{ background: "#0f172a", color: "#fff", border: "none", borderRadius: "10px", padding: "10px 14px", fontWeight: "600", cursor: "pointer", textDecoration: "none" }}
                  >
                    İncele
                  </Link>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteReport(rapor.id);
                    }}
                    style={{
                      background: "#dc2626",
                      color: "#fff",
                      border: "none",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      fontWeight: "600",
                      cursor: "pointer",
                    }}
                  >
                    Sil
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, color }) {
  return (
    <div style={{ background: "#ffffff", borderRadius: "16px", padding: "18px", boxShadow: "0 10px 25px rgba(0,0,0,0.06)" }}>
      <div style={{ color: "#6b7280", fontSize: "14px" }}>{title}</div>
      <div style={{ marginTop: "10px", fontSize: "28px", fontWeight: "700", color }}>
        {value}
      </div>
    </div>
  );
}

function MiniCard({ title, value }) {
      return (
        <div className="rounded-2xl border border-white/10 bg-white/10 p-4 backdrop-blur">
        <div className="text-xs text-slate-300">
          {title}
        </div>

        <div className="mt-2 text-3xl font-black text-white">
          {value}
        </div>
      </div>
      );
}
