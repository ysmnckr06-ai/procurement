"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

const baslangicRaporlari = [
  {
    id: 1,
    ad: "Laptop Alımı",
    tarih: "2026-04-10",
    durum: "Tamamlandı",
    tur: "Mukayese",
    firma: "Tekno A.Ş.",
  },
  {
    id: 2,
    ad: "Ofis Malzemesi",
    tarih: "2026-04-09",
    durum: "Bekliyor",
    tur: "Son Alım",
    firma: "Ofis Market",
  },
  {
    id: 3,
    ad: "Temizlik Ürünleri",
    tarih: "2026-04-08",
    durum: "Gecikmiş",
    tur: "Mukayese",
    firma: "Temiz Paket",
  },
  {
    id: 4,
    ad: "Yazıcı Toneri",
    tarih: "2026-04-07",
    durum: "Tamamlandı",
    tur: "Son Alım",
    firma: "KartuşX",
  },
];

export default function RaporlarPage() {
  const [arama, setArama] = useState("");
  const [durumFiltre, setDurumFiltre] = useState("Tümü");

  const filtreliRaporlar = useMemo(() => {
    return baslangicRaporlari.filter((rapor) => {
      const adUyum = rapor.ad.toLowerCase().includes(arama.toLowerCase());
      const durumUyum =
        durumFiltre === "Tümü" ? true : rapor.durum === durumFiltre;

      return adUyum && durumUyum;
    });
  }, [arama, durumFiltre]);

  const durumRenkleri = {
    Tamamlandı: { arkaPlan: "#DCFCE7", yazi: "#166534" },
    Bekliyor: { arkaPlan: "#FEF3C7", yazi: "#92400E" },
    Gecikmiş: { arkaPlan: "#FEE2E2", yazi: "#991B1B" },
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: "32px",
      }}
    >
      <div
        style={{
          maxWidth: "1100px",
          margin: "0 auto",
        }}
      >
        <div style={{ marginBottom: "24px" }}>
          <h1
            style={{
              margin: 0,
              fontSize: "34px",
              fontWeight: "700",
              color: "#111827",
            }}
          >
            Raporlar
          </h1>
          <p
            style={{
              marginTop: "8px",
              color: "#6b7280",
              fontSize: "15px",
            }}
          >
            Oluşturulan raporları görüntüleyin, filtreleyin ve yönetin.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "16px",
            marginBottom: "24px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              padding: "18px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "14px" }}>
              Toplam Rapor
            </div>
            <div
              style={{
                marginTop: "10px",
                fontSize: "28px",
                fontWeight: "700",
                color: "#111827",
              }}
            >
              {baslangicRaporlari.length}
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              padding: "18px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "14px" }}>
              Tamamlanan
            </div>
            <div
              style={{
                marginTop: "10px",
                fontSize: "28px",
                fontWeight: "700",
                color: "#166534",
              }}
            >
              {baslangicRaporlari.filter((r) => r.durum === "Tamamlandı").length}
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              padding: "18px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "14px" }}>Bekleyen</div>
            <div
              style={{
                marginTop: "10px",
                fontSize: "28px",
                fontWeight: "700",
                color: "#92400E",
              }}
            >
              {baslangicRaporlari.filter((r) => r.durum === "Bekliyor").length}
            </div>
          </div>

          <div
            style={{
              background: "#ffffff",
              borderRadius: "16px",
              padding: "18px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            }}
          >
            <div style={{ color: "#6b7280", fontSize: "14px" }}>Gecikmiş</div>
            <div
              style={{
                marginTop: "10px",
                fontSize: "28px",
                fontWeight: "700",
                color: "#991B1B",
              }}
            >
              {baslangicRaporlari.filter((r) => r.durum === "Gecikmiş").length}
            </div>
          </div>
        </div>

        <div
          style={{
            background: "#ffffff",
            borderRadius: "16px",
            padding: "18px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            marginBottom: "20px",
            display: "flex",
            gap: "12px",
            flexWrap: "wrap",
          }}
        >
          <input
            type="text"
            placeholder="Rapor ara..."
            value={arama}
            onChange={(e) => setArama(e.target.value)}
            style={{
              flex: "1",
              minWidth: "240px",
              padding: "12px 14px",
              border: "1px solid #d1d5db",
              borderRadius: "12px",
              fontSize: "14px",
              outline: "none",
            }}
          />

          <select
            value={durumFiltre}
            onChange={(e) => setDurumFiltre(e.target.value)}
            style={{
              padding: "12px 14px",
              border: "1px solid #d1d5db",
              borderRadius: "12px",
              fontSize: "14px",
              background: "#fff",
            }}
          >
            <option>Tümü</option>
            <option>Tamamlandı</option>
            <option>Bekliyor</option>
            <option>Gecikmiş</option>
          </select>
        </div>

        <div style={{ display: "grid", gap: "16px" }}>
          {filtreliRaporlar.map((rapor) => (
            <div
              key={rapor.id}
              style={{
                background: "#ffffff",
                borderRadius: "18px",
                padding: "20px",
                boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
                border: "1px solid #e5e7eb",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: "16px",
                  alignItems: "flex-start",
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <div
                    style={{
                      fontSize: "20px",
                      fontWeight: "700",
                      color: "#111827",
                      marginBottom: "8px",
                    }}
                  >
                    {rapor.id}. {rapor.ad}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: "10px",
                      flexWrap: "wrap",
                      fontSize: "14px",
                      color: "#6b7280",
                    }}
                  >
                    <span>Tarih: {rapor.tarih}</span>
                    <span>Tür: {rapor.tur}</span>
                    <span>Firma: {rapor.firma}</span>
                  </div>
                </div>

                <div
                  style={{
                    background: durumRenkleri[rapor.durum].arkaPlan,
                    color: durumRenkleri[rapor.durum].yazi,
                    padding: "8px 14px",
                    borderRadius: "999px",
                    fontWeight: "700",
                    fontSize: "13px",
                  }}
                >
                  {rapor.durum}
                </div>
              </div>

              <div
                style={{
                  marginTop: "16px",
                  display: "flex",
                  gap: "10px",
                  flexWrap: "wrap",
                }}
              >
                <Link
                  href={`/dashboard/raporlar/${rapor.id}`}
                  style={{
                    background: "#111827",
                    color: "#fff",
                    textDecoration: "none",
                    borderRadius: "10px",
                    padding: "10px 14px",
                    fontWeight: "600",
                  }}
                >
                  İncele
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}