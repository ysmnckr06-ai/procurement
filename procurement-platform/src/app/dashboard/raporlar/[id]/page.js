import Link from "next/link";

export default async function RaporDetayPage({ params }) {
  const { id } = await params;

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
          maxWidth: "1000px",
          margin: "0 auto",
        }}
      >
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
            <h2
              style={{
                marginTop: 0,
                marginBottom: "12px",
                fontSize: "22px",
                color: "#111827",
              }}
            >
              Mukayese Raporu
            </h2>

            <p
              style={{
                color: "#6b7280",
                fontSize: "14px",
                lineHeight: "1.6",
              }}
            >
              Bu alanda firmaların teklif fiyatları, teslim süresi, uygunluk
              durumu ve genel karşılaştırma bilgileri gösterilecek.
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
            <h2
              style={{
                marginTop: 0,
                marginBottom: "12px",
                fontSize: "22px",
                color: "#111827",
              }}
            >
              Son Alım Raporu
            </h2>

            <p
              style={{
                color: "#6b7280",
                fontSize: "14px",
                lineHeight: "1.6",
              }}
            >
              Bu alanda ürünün geçmiş alım bilgileri, önceki fiyatlar, tedarikçi
              geçmişi ve son alım özeti gösterilecek.
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