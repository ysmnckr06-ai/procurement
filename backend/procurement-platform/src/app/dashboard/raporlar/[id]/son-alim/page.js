export default async function SonAlimPage({ params }) {
  const { id } = await params;

  const gecmisAlimlar = [
    { tarih: "2025-12-14", firma: "Tekno A.Ş.", fiyat: "118.000 TL", miktar: "10 Adet" },
    { tarih: "2025-08-03", firma: "Nova Teknoloji", fiyat: "121.500 TL", miktar: "8 Adet" },
    { tarih: "2025-03-21", firma: "Artemis Bilişim", fiyat: "119.750 TL", miktar: "12 Adet" },
  ];

  const sonAlim = gecmisAlimlar[0];

  const enDusukGecmisFiyat = gecmisAlimlar.reduce((min, item) => {
    const fiyat = parseInt(item.fiyat.replace(/\D/g, ""));
    const minFiyat = parseInt(min.fiyat.replace(/\D/g, ""));
    return fiyat < minFiyat ? item : min;
  });

  const toplamAlimSayisi = gecmisAlimlar.length;

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
            <strong>🧾 Son Alım:</strong> {sonAlim.firma} ({sonAlim.fiyat})
          </div>

          <div>
            <strong>📉 En Düşük Geçmiş Fiyat:</strong> {enDusukGecmisFiyat.firma} ({enDusukGecmisFiyat.fiyat})
          </div>

          <div>
            <strong>📦 Toplam Kayıt:</strong> {toplamAlimSayisi}
          </div>
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
            Son Alım Raporu
          </h1>
          <p style={{ marginTop: "10px", color: "#6b7280" }}>
            Rapor No: {id} • Geçmiş satın alma bilgileri
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
                <th style={thStyle}>Tarih</th>
                <th style={thStyle}>Firma</th>
                <th style={thStyle}>Fiyat</th>
                <th style={thStyle}>Miktar</th>
              </tr>
            </thead>
            <tbody>
              {gecmisAlimlar.map((item, index) => (
                <tr
                  key={index}
                  style={{
                    backgroundColor: index === 0 ? "#eff6ff" : "white",
                  }}
                >
                  <td style={tdStyle}>{item.tarih}</td>

                  <td style={tdStyle}>
                    {item.firma}
                    {index === 0 && (
                      <span
                        style={{
                          marginLeft: "10px",
                          background: "#2563eb",
                          color: "white",
                          padding: "4px 8px",
                          borderRadius: "999px",
                          fontSize: "12px",
                          fontWeight: "600",
                        }}
                      >
                        SON ALIM
                      </span>
                    )}
                  </td>

                  <td style={tdStyle}>{item.fiyat}</td>
                  <td style={tdStyle}>{item.miktar}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
