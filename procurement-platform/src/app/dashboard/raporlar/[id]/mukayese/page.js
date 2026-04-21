export default async function MukayesePage({ params }) {
  const { id } = await params;

  const firmalar = [
    { firma: "Tekno A.Ş.", fiyat: "120.000 TL", teslim: "5 Gün", durum: "Uygun" },
    { firma: "Nova Teknoloji", fiyat: "128.500 TL", teslim: "3 Gün", durum: "Uygun" },
    { firma: "Artemis Bilişim", fiyat: "135.000 TL", teslim: "7 Gün", durum: "İnceleniyor" },
  ];

  const enUcuz = firmalar.reduce((min, item) => {
    const fiyat = parseInt(item.fiyat.replace(/\D/g, ""));
    const minFiyat = parseInt(min.fiyat.replace(/\D/g, ""));
    return fiyat < minFiyat ? item : min;
  });

  const enHizli = firmalar.reduce((min, item) => {
    const gun = parseInt(item.teslim);
    const minGun = parseInt(min.teslim);
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
              {firmalar.map((item, index) => (
                <tr
                  key={index}
                  style={{
                    backgroundColor: item.firma === enUcuz.firma ? "#ecfdf5" : "white",
                  }}
                >
                  <td style={tdStyle}>
                    {item.firma}

                    {item.firma === enUcuz.firma && (
                      <span
                        style={{
                          marginLeft: "10px",
                          background: "#16a34a",
                          color: "white",
                          padding: "4px 8px",
                          borderRadius: "999px",
                          fontSize: "12px",
                          fontWeight: "600",
                        }}
                      >
                        SEÇİLDİ
                      </span>
                    )}

                    {altinOneri && item.firma === altinOneri.firma && (
                      <span
                        style={{
                          marginLeft: "10px",
                          background: "#f59e0b",
                          color: "white",
                          padding: "4px 8px",
                          borderRadius: "999px",
                          fontSize: "12px",
                          fontWeight: "600",
                        }}
                      >
                        ALTIN ÖNERİ
                      </span>
                    )}
                  </td>

                  <td style={tdStyle}>{item.fiyat}</td>
                  <td style={tdStyle}>{item.teslim}</td>
                  <td style={tdStyle}>{item.durum}</td>
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