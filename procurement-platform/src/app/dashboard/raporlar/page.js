const raporlar = [
  {
    id: 1,
    ad: "Laptop Alımı",
    tarih: "2026-04-10",
  },
  {
    id: 2,
    ad: "Ofis Malzemesi",
    tarih: "2026-04-09",
  },
  {
    id: 3,
    ad: "Temizlik Ürünleri",
    tarih: "2026-04-08",
  },
];

export default function RaporlarPage() {
  return (
    <div style={{ padding: "20px" }}>
      <h1>Raporlar</h1>

      {raporlar.map((rapor) => (
        <div
          key={rapor.id}
          style={{
            border: "1px solid #ccc",
            padding: "10px",
            marginTop: "10px",
            cursor: "pointer",
          }}
        >
          <h3>{rapor.id}. {rapor.ad}</h3>
          <p>{rapor.tarih}</p>
        </div>
      ))}
    </div>
  );
}