"use client";

import Link from "next/link";

export default function RaporDetayPage({ params }) {
  const { id } = params;

  const rapor = {
    id,
    ad:
      id === "1"
        ? "Laptop Alımı"
        : id === "2"
        ? "Ofis Malzemesi"
        : id === "3"
        ? "Temizlik Ürünleri"
        : "Yazıcı Toneri",
    tarih: "2026-04-10",
    durum: "Hazır",
    onerilenFirma:
      id === "1"
        ? "Tekno A.Ş."
        : id === "2"
        ? "Ofis Market"
        : id === "3"
        ? "Temiz Paket"
        : "KartuşX",
    miktar: id === "1" ? 10 : id === "2" ? 50 : id === "3" ? 30 : 20,
    termin: "2026-04-30",
  };

  function siparisOlustur() {
    const orderData = {
      company: rapor.onerilenFirma,
      product: rapor.ad,
      quantity: rapor.miktar,
      dueDate: rapor.termin,
    };

    localStorage.setItem("pendingOrder", JSON.stringify(orderData));
    window.location.href = "/dashboard/siparisler";
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f3f4f6",
        padding: "32px",
      }}
    >
      <div style={{ maxWidth: "1000px", margin: "0 auto" }}>
        <div
          style={{
            background: "#ffffff",
            borderRadius: "18px",
            padding: "24px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            marginBottom: "24px",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "30px",
              fontWeight: "700",
              color: "#111827",
            }}
          >
            {rapor.id}. {rapor.ad}
          </h1>

          <p
            style={{
              marginTop: "10px",
              color: "#6b7280",
              fontSize: "15px",
            }}
          >
            Tarih: {rapor.tarih} • Durum: {rapor.durum}
          </p>
        </div>

        <div
          style={{
            background: "#ecfdf5",
            border: "1px solid #bbf7d0",
            borderRadius: "18px",
            padding: "22px",
            marginBottom: "24px",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "22px",
              color: "#166534",
            }}
          >
            Önerilen Sipariş Kararı
          </h2>

          <p style={{ color: "#166534", marginTop: "10px" }}>
            En uygun firma: <b>{rapor.onerilenFirma}</b>
          </p>

          <p style={{ color: "#166534" }}>
            Ürün: <b>{rapor.ad}</b> • Miktar: <b>{rapor.miktar}</b> • Termin:{" "}
            <b>{rapor.termin}</b>
          </p>

          <button
            onClick={siparisOlustur}
            style={{
              marginTop: "12px",
              background: "#16a34a",
              color: "#fff",
              border: "none",
              borderRadius: "10px",
              padding: "12px 16px",
              fontWeight: "700",
              cursor: "pointer",
            }}
          >
            Bu Firmayla Sipariş Oluştur
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "20px",
          }}
        >
          <div
            style={{
              background: "#ffffff",
              borderRadius: "18px",
              padding: "24px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
              border: "1px solid #e5e7eb",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "22px", color: "#111827" }}>
              Mukayese Raporu
            </h2>

            <p style={{ color: "#6b7280", fontSize: "14px", lineHeight: "1.6" }}>
              Firmaların teklif fiyatları, teslim süresi ve genel karşılaştırma
              bilgileri burada görüntülenir.
            </p>

            <Link
              href={`/dashboard/raporlar/${rapor.id}/mukayese`}
              style={{
                display: "inline-block",
                marginTop: "16px",
                background: "#111827",
                color: "#fff",
                textDecoration: "none",
                borderRadius: "10px",
                padding: "10px 14px",
                fontWeight: "600",
              }}
            >
              Mukayese Raporunu Aç
            </Link>
          </div>

          <div
            style={{
              background: "#ffffff",
              borderRadius: "18px",
              padding: "24px",
              boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
              border: "1px solid #e5e7eb",
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: "22px", color: "#111827" }}>
              Son Alım Raporu
            </h2>

            <p style={{ color: "#6b7280", fontSize: "14px", lineHeight: "1.6" }}>
              Ürünün geçmiş alım bilgileri, önceki fiyatları ve tedarikçi geçmişi
              burada görüntülenir.
            </p>

            <Link
              href={`/dashboard/raporlar/${rapor.id}/son-alim`}
              style={{
                display: "inline-block",
                marginTop: "16px",
                background: "#2563eb",
                color: "#fff",
                textDecoration: "none",
                borderRadius: "10px",
                padding: "10px 14px",
                fontWeight: "600",
              }}
            >
              Son Alım Raporunu Aç
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}