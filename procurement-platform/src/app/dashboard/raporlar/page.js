"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

export default function RaporlarPage() {
  const [raporlar, setRaporlar] = useState([]);
  const [arama, setArama] = useState("");
  const [durumFiltre, setDurumFiltre] = useState("Tümü");

  useEffect(() => {
    fetch("http://127.0.0.1:8000/reports")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) setRaporlar(data.reports || []);
      });
  }, []);

  const filtreliRaporlar = useMemo(() => {
    return raporlar.filter((rapor) => {
      const ad = String(rapor.ad || "").toLowerCase();
      const firma = String(rapor.onerilenFirma || "").toLowerCase();
      const aramaLower = arama.toLowerCase();

      const aramaUyum = ad.includes(aramaLower) || firma.includes(aramaLower);
      const durumUyum =
        durumFiltre === "Tümü" ? true : rapor.durum === durumFiltre;

      return aramaUyum && durumUyum;
    });
  }, [raporlar, arama, durumFiltre]);

  const durumRenkleri = {
    Tamamlandı: { arkaPlan: "#DCFCE7", yazi: "#166534" },
    Bekliyor: { arkaPlan: "#FEF3C7", yazi: "#92400E" },
    Gecikmiş: { arkaPlan: "#FEE2E2", yazi: "#991B1B" },
  };

async function createOrderFromReport(rapor) {
  localStorage.setItem(
    "pendingOrder",
    JSON.stringify({
      company: rapor.onerilenFirma || "",
      product: rapor.ad || "",
      quantity: 1,
      dueDate: "",
      reportId: rapor.id,
      reportName: rapor.ad,
    })
  );

  try {
    await fetch(`http://127.0.0.1:8000/reports/${rapor.id}/create-order`, {
      method: "POST",
    });
  } catch (error) {
    console.log("Backend sipariş oluşturma hatası:", error);
  }

  window.location.href = "/dashboard/siparisler";
}

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "32px" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div style={{ marginBottom: "24px" }}>
          <h1 style={{ margin: 0, fontSize: "34px", fontWeight: "700", color: "#111827" }}>
            Raporlar
          </h1>
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
            const renk = durumRenkleri[rapor.durum] || durumRenkleri.Bekliyor;

            return (
              <div
                key={rapor.id}
                style={{ background: "#ffffff", borderRadius: "18px", padding: "20px", boxShadow: "0 10px 25px rgba(0,0,0,0.06)", border: "1px solid #e5e7eb" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: "20px", fontWeight: "700", color: "#111827", marginBottom: "8px" }}>
                      {index + 1}. {rapor.ad}
                    </div>

                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", fontSize: "14px", color: "#6b7280" }}>
                      <span>Tarih: {rapor.tarih}</span>
                      <span>Tür: {rapor.tur}</span>
                      <span>Firma: {rapor.onerilenFirma}</span>
                    </div>
                  </div>

                  <div style={{ background: renk.arkaPlan, color: renk.yazi, padding: "8px 14px", borderRadius: "999px", fontWeight: "700", fontSize: "13px" }}>
                    {rapor.durum}
                  </div>
                </div>

                <div style={{ marginTop: "16px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
                  <Link
                    href={`/dashboard/raporlar/${rapor.id}`}
                    style={{ background: "#111827", color: "#fff", textDecoration: "none", borderRadius: "10px", padding: "10px 14px", fontWeight: "600" }}
                  >
                    İncele
                  </Link>

                  <a
                    href={`http://127.0.0.1:8000${rapor.reportPath}`}
                    style={{ background: "#2563eb", color: "#fff", textDecoration: "none", borderRadius: "10px", padding: "10px 14px", fontWeight: "600" }}
                  >
                    Raporu İndir
                  </a>

                  <button
                    type="button"
                    disabled={rapor.durum === "Tamamlandı"}
                    onClick={() => createOrderFromReport(rapor)}
                    style={{
                      background: rapor.durum === "Tamamlandı" ? "#9ca3af" : "#16a34a",
                      color: "#fff",
                      border: "none",
                      borderRadius: "10px",
                      padding: "10px 14px",
                      fontWeight: "600",
                      cursor: rapor.durum === "Tamamlandı" ? "not-allowed" : "pointer",
                    }}
                  >
                    {rapor.durum === "Tamamlandı" ? "Sipariş Oluşturuldu" : "Sipariş Oluştur"}
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