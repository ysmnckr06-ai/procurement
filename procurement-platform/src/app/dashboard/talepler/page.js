"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

function StatCard({ icon, title, value, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-2xl">
          {icon}
        </div>

        <div>
          <div className="text-sm text-slate-500">{title}</div>
          <div className="mt-1 text-3xl font-bold text-slate-900">{value}</div>
          <div className="text-sm text-slate-500">{text}</div>
        </div>
      </div>
    </div>
  );
}

function Step({ no, title, text }) {
  return (
    <div>
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 font-bold text-blue-700">
        {no}
      </div>
      <div className="font-bold text-slate-800">{title}</div>
      <p className="mt-1 text-xs text-slate-500">{text}</p>
    </div>
  );
}

export default function TaleplerPage() {
  const router = useRouter();
  const [files, setFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [reportPath, setReportPath] = useState("");
  const [rows, setRows] = useState([]);

  const totalQty = useMemo(() => {
    return rows.reduce((sum, r) => sum + Number(r.talepEdilenAdet || 0), 0);
  }, [rows]);

  const handleFileChange = (e) => {
    setFiles(Array.from(e.target.files || []));
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      setMessage("Lütfen dosya yükleyin.");
      return;
    }

    setIsLoading(true);
    setMessage("");

    const formData = new FormData();
    files.forEach((file) => formData.append("files", file));



    try {
      const response = await fetch("http://127.0.0.1:8000/analyze-requests", {
        method: "POST",
        body: formData,
    });

      const data = await response.json();

      if (!data.success) {
        setMessage(data.warnings?.join(", ") || "Hata oluştu.");
        setIsLoading(false);
        return;
      }

      setRows(data.rows || []);
      setReportPath(data.reportPath || "");
      setMessage("Talep listesi oluşturuldu ✅");
    } catch (err) {
      console.error(err);
      setMessage("Backend bağlantı hatası ❌");
    }

    setIsLoading(false);
  };

  const handleDownload = () => {
    if (!reportPath) return;
    window.open(`https://procurement-production-f3ac.up.railway.app${reportPath}`, "_blank");
  };

  const handleSendToOffers = () => {
    if (!reportPath) {
      setMessage("Önce talep listesi oluşturmalısınız.");
      return;
    }

    const yeniTalep = {
      id: Date.now(),
      fileName: "talep_listesi.xlsx",
      reportPath: reportPath,
      rows: rows,
      createdAt: new Date().toLocaleString("tr-TR"),
      itemCount: rows.length,
      status: "Aktif",
    };

    const eskiTalepler = JSON.parse(
      localStorage.getItem("talepListeleri") || "[]"
    );

    localStorage.setItem(
      "talepListeleri",
      JSON.stringify([yeniTalep, ...eskiTalepler])
    );

    setMessage("Talep listesi tekliflere aktarıldı ✅");

    setTimeout(() => {
      router.push("/dashboard/teklifler");
    }, 700);
  };
  return (
    <div className="min-h-screen bg-slate-100">

      <main className="flex-1 p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-100 text-3xl">
              📚
            </div>

            <div>
              <h1 className="text-3xl font-bold text-slate-900">Talepler</h1>
              <p className="mt-1 text-sm text-slate-600">
                Talep dosyalarınızı yükleyin, icmal listenizi oluşturun ve teklif
                karşılaştırmalarında kullanın.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <StatCard icon="📄" title="Yüklenen Dosya" value={files.length} text="Seçili dosya" />
            <StatCard icon="📦" title="Toplam Kalem" value={rows.length} text="İcmal listesinde" />
            <StatCard icon="🔢" title="Toplam Miktar" value={totalQty} text="Talep edilen adet" />
            <StatCard icon="✅" title="Durum" value={reportPath ? "Hazır" : "Bekliyor"} text={reportPath ? "Excel oluşturuldu" : "Analiz bekleniyor"} />
          </div>

          <div className="rounded-2xl border border-purple-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 text-2xl">
                💡
              </div>
              <p className="text-sm font-medium text-purple-900">
                Burada yüklediğiniz Excel, PDF veya görsel talep dosyaları backend
                tarafından analiz edilir. Ürün kodu, açıklama, adet ve birim
                bilgileri icmal listesine dönüştürülür.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-800">
              Yeni Talep Listesi Oluştur
            </h2>

            <p className="mt-1 text-sm text-slate-500">
              En fazla 15 dosya yükleyebilirsiniz. Desteklenen formatlar: Excel,
              PDF ve görsel dosyalar.
            </p>

            <div className="mt-5 rounded-2xl border border-dashed border-blue-300 bg-slate-50 p-8 text-center">
              <input
                type="file"
                multiple
                accept=".xlsx,.xls,.pdf,.png,.jpg,.jpeg"
                onChange={handleFileChange}
                className="mx-auto block w-full max-w-xl rounded-xl border border-slate-300 bg-white p-3"
              />

              <p className="mt-3 text-sm text-slate-500">
                Desteklenen formatlar: .xlsx, .xls, .pdf, .png, .jpg, .jpeg
              </p>

              {files.length > 0 && (
                <div className="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-left">
                  <div className="text-sm font-bold text-blue-900">
                    Seçilen Dosyalar
                  </div>

                  <div className="mt-2 space-y-1 text-sm text-blue-800">
                    {files.map((file, index) => (
                      <div key={index}>📎 {file.name}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="mt-5 flex flex-wrap gap-3">
              <button
                onClick={handleAnalyze}
                disabled={isLoading}
                className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {isLoading ? "İcmal Oluşturuluyor..." : "+ Talep Listesini Oluştur"}
              </button>

              <button
                onClick={handleDownload}
                disabled={!reportPath}
                className="rounded-xl bg-green-600 px-5 py-3 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Excel İndir
              </button>

              <button
                onClick={handleSendToOffers}
                disabled={rows.length === 0}
                className="rounded-xl bg-purple-600 px-5 py-3 text-sm font-bold text-white hover:bg-purple-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Tekliflere Aktar
              </button>
            </div>

            {message && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700">
                {message}
              </div>
            )}
          </div>

          {rows.length > 0 && (
            <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 p-5">
                <div>
                  <h2 className="text-xl font-bold text-slate-800">
                    İcmal Önizleme
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Backend tarafından oluşturulan talep icmal listesi.
                  </p>
                </div>

                <span className="rounded-full bg-green-100 px-4 py-2 text-sm font-bold text-green-700">
                  {rows.length} kalem
                </span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="p-4">Sıra</th>
                      <th className="p-4">Kod</th>
                      <th className="p-4">Açıklama</th>
                      <th className="p-4">Adet</th>
                      <th className="p-4">Birim</th>
                    </tr>
                  </thead>

                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-t border-slate-100">
                        <td className="p-4 font-medium text-slate-600">{i + 1}</td>
                        <td className="p-4 font-bold text-slate-800">{r.urunKodu || "-"}</td>
                        <td className="p-4 text-slate-700">{r.urunAciklamasi || "-"}</td>
                        <td className="p-4 font-bold text-slate-800">{r.talepEdilenAdet || 0}</td>
                        <td className="p-4 text-slate-600">{r.birim || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-bold text-blue-700">Nasıl Çalışır?</h3>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
                <Step no="1" title="Dosya Yükleyin" text="Excel, PDF veya görsel talep dosyalarınızı seçin." />
                <Step no="2" title="İcmal Oluşturun" text="Sistem ürünleri birleştirip talep listesini çıkarır." />
                <Step no="3" title="Tekliflere Aktarın" text="Oluşan listeyi teklif karşılaştırmada kullanın." />
              </div>
            </div>

            <div className="rounded-2xl border border-green-200 bg-green-50 p-6 shadow-sm">
              <h3 className="text-lg font-bold text-green-800">İpuçları</h3>

              <div className="mt-4 space-y-3 text-sm text-green-900">
                <p>✅ Ürün kodu varsa sistem eşleştirmeyi daha güçlü yapar.</p>
                <p>✅ Kod yoksa açıklama benzerliğiyle icmal oluşturulur.</p>
                <p>✅ Oluşturulan talep listesi teklif analizinde ana referans olur.</p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}