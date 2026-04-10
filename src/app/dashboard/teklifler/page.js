"use client";

export default function TekliflerPage() {
  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl rounded-2xl bg-white p-6 shadow-sm md:p-8">
        <h1 className="text-3xl font-bold text-slate-800">Teklifler</h1>
        <p className="mt-2 text-slate-600">
          Tedarikçilerden gelen teklifleri yükleyip karşılaştırma tablosu oluşturacağız.
        </p>

        <div className="mt-8 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 p-8 text-center">
          <h2 className="text-xl font-semibold text-slate-800">
            Dosya Yükleme Alanı
          </h2>
          <p className="mt-2 text-slate-600">
            Excel, PDF ve görsel teklif dosyalarını burada işleyeceğiz.
          </p>

          <button className="mt-5 rounded-xl bg-slate-800 px-6 py-3 text-white hover:bg-slate-700">
            Dosya Seç
          </button>
        </div>
      </div>
    </main>
  );
}