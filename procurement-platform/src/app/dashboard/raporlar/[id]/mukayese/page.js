import { supabase } from "@/lib/supabase";
export default async function MukayesePage({ params }) {
  const { id } = await params;

const { data: report, error } = await supabase
  .from("reports")
  .select("*")
  .eq("id", id)
  .single();

if (error || !report) {
  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "32px" }}>
      <div style={{
        maxWidth: "900px",
        margin: "0 auto",
        background: "#fff",
        borderRadius: "18px",
        padding: "24px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.06)"
      }}>
        <h1>Rapor bulunamadı</h1>
        <p>Supabase içinde bu ID ile rapor kaydı bulunamadı.</p>
      </div>
    </div>
  );
}

console.log("MUKAYESE REPORT:", report);

const analiz = report?.analysis || {};

const firmalar =
  analiz.mukayese ||
  analiz.groups ||
  analiz.analyzed ||
  (Array.isArray(analiz) ? analiz : []);

if (firmalar.length === 0) {
  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "32px" }}>
      <div style={{
        maxWidth: "900px",
        margin: "0 auto",
        background: "#fff",
        borderRadius: "18px",
        padding: "24px",
        boxShadow: "0 10px 25px rgba(0,0,0,0.06)"
      }}>
        <h1>Mukayese verisi bulunamadı</h1>
        <p>
          Rapor kaydı geldi ama detaylı firma listesi henüz rapora kaydedilmemiş.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", background: "#f8fafc", padding: "16px" }}>
          {JSON.stringify(report, null, 2)}
        </pre>
      </div>
    </div>
  );
}

  const enUcuz = firmalar.reduce((min, item) => {
  const fiyat = Number(item.fiyat ?? item.birimFiyat ?? item.satirToplamDosyadan ?? 0);
  const minFiyat = Number(min.fiyat ?? min.birimFiyat ?? min.satirToplamDosyadan ?? 0);

  return fiyat < minFiyat ? item : min;
});

  const enHizli = firmalar.reduce((min, item) => {
  const gun = parseInt(item.teslim ?? item.termin ?? 999);
  const minGun = parseInt(min.teslim ?? min.termin ?? 999);

  return gun < minGun ? item : min;
});

  const altinOneri = enUcuz.firma === enHizli.firma ? enUcuz : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f3f4f6", padding: "32px" }}>
      <div style={{ maxWidth: "1100px", margin: "0 auto" }}>
        <div
          style={{
            background: "#ffffff",
            borderRadius: "18px",
            padding: "20px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            marginBottom: "20px",
            display: "flex",
            gap: "20px",
            flexWrap: "wrap",
          }}
        >
          <div>
            <strong>💰 En Ucuz:</strong> {enUcuz.firma} ({enUcuz.fiyat})
          </div>

          <div>
            <strong>⚡ En Hızlı:</strong> {enHizli.firma} ({enHizli.teslim})
          </div>

          <div>
            <strong>🏆 Önerilen:</strong> {enUcuz.firma}
          </div>

          {altinOneri && (
            <div>
              <strong>🥇 Altın Öneri:</strong> {altinOneri.firma}
            </div>
          )}
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: "18px",
            padding: "24px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            marginBottom: "24px",
          }}
        >
          <h1 style={{ margin: 0, fontSize: "30px", color: "#111827" }}>
            Mukayese Raporu
          </h1>
          <p style={{ marginTop: "10px", color: "#6b7280" }}>
            Rapor No: {id} • Firmaların teklif karşılaştırması
          </p>
        </div>

        <div
          style={{
            background: "#fff",
            borderRadius: "18px",
            padding: "20px",
            boxShadow: "0 10px 25px rgba(0,0,0,0.06)",
            overflowX: "auto",
          }}
        >
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f9fafb" }}>
                <th style={thStyle}>Firma</th>
                <th style={thStyle}>Teklif Fiyatı</th>
                <th style={thStyle}>Teslim Süresi</th>
                <th style={thStyle}>Durum</th>
              </tr>
            </thead>
            <tbody>
              {firmalar.map((item, index) => {
                const best = item.bestOffer || {};

                const firmaAdi =
                  item.onerilenFirma ||
                  best.firma ||
                  best.firmaAdi ||
                  "-";

                const fiyat =
                  item.enAvantajliNetTutarTRY ||
                  best.netToplamTRY ||
                  best.tcoTRY ||
                  best.birimFiyat ||
                  "-";

                const teslim = "-";

                return (
                  <tr key={index}>
                  <td style={tdStyle}>{firmaAdi}</td>
                  <td style={tdStyle}>{fiyat}</td>
                  <td style={tdStyle}>
                    {typeof teslim === "number"
                      ? `${teslim} gün`
                      : teslim}
                  </td>
                  <td style={tdStyle}>{item.durum || "Hazır"}</td>
              </tr>
            );
          })}
            </tbody>
          </table>
          <div
             style={{
              marginTop: "24px",
              background: "#f8fafc",
              border: "1px solid #e2e8f0",
              borderRadius: "16px",
              padding: "20px",
            }}
          >
            <h3
            style={{
              marginTop: 0,
              marginBottom: "12px",
              color: "#0f172a",
              fontSize: "20px",
            }}
          >
            🤖 AI Değerlendirmesi
          </h3>

          <p style={{ color: "#475569", lineHeight: "1.7" }}>
            {enUcuz.firma} firması fiyat avantajı nedeniyle ön plana çıkmıştır.
            Teslim süresi değerlendirildiğinde operasyon açısından uygun görünmektedir.
            Genel maliyet ve termin dengesi incelendiğinde satın alma için en avantajlı teklif olarak önerilmektedir.
          </p>

          <div
            style={{
              marginTop: "16px",
              display: "flex",
              gap: "12px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{
                background: "#dcfce7",
                color: "#166534",
                padding: "6px 12px",
                borderRadius: "999px",
                fontSize: "13px",
                fontWeight: "600",
              }}
            >
              ✔ En uygun fiyat
            </span>

            <span
              style={{
                background: "#dbeafe",
                color: "#1d4ed8",
                padding: "6px 12px",
                borderRadius: "999px",
                fontSize: "13px",
                fontWeight: "600",
              }}
            >
              ⚡ Uygun teslim süresi
            </span>

            <span
              style={{
                background: "#fef3c7",
                color: "#92400e",
                padding: "6px 12px",
                borderRadius: "999px",
                fontSize: "13px",
                fontWeight: "600",
              }}
            >
              🏆 Satın alma önerisi
    </span>
  </div>
</div>
        </div>
      </div>
    </div>
  );
}

const thStyle = {
  textAlign: "left",
  padding: "14px",
  borderBottom: "1px solid #e5e7eb",
  color: "#374151",
  fontSize: "14px",
};

const tdStyle = {
  padding: "14px",
  borderBottom: "1px solid #e5e7eb",
  fontSize: "14px",
  color: "#111827",
};