"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function RaporDetayPage() {
  const params = useParams();
  const id = params.id;

  const [rapor, setRapor] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!id) return;

    fetch(`${process.env.NEXT_PUBLIC_API_URL}/reports/${id}`)
      .then((res) => res.json())
      .then((data) => {
    console.log("RAPOR DETAY DATA:", data);

    if (data.success) {
        setRapor(data.report);
    } else {
        setMessage("Rapor bulunamadı.");
    }
})
      .catch(() => {
        setMessage("Rapor detayı alınırken hata oluştu.");
      });
  }, [id]);

async function siparisOlustur() {
  try {
    setLoading(true);
    setMessage("Sipariş oluşturuluyor...");

    const res = await fetch(
      `https://procurement-production-f3ac.up.railway.app/reports/${id}/create-order`,
      { method: "POST" }
    );

    const data = await res.json();

    if (data.success) {
      setMessage("Sipariş başarıyla oluşturuldu. Yönlendiriliyorsun...");
      window.location.href = "/dashboard/siparisler";
    } else {
      setMessage(data.message || "Sipariş oluşturulamadı.");
    }
  } catch (error) {
    setMessage("Bağlantı hatası. Sipariş oluşturulamadı.");
  } finally {
    setLoading(false);
  }
}

  if (!rapor) {
    return (
      <div className="min-h-screen bg-slate-100 p-8">
        <div className="mx-auto max-w-4xl rounded-2xl bg-white p-6 shadow-sm">
          {message || "Yükleniyor..."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Link
            href="/dashboard/raporlar"
            className="text-sm font-bold text-blue-700"
          >
            ← Raporlara Dön
          </Link>

          <h1 className="mt-4 text-3xl font-bold text-slate-900">
            {rapor.ad}
          </h1>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Info label="Tarih" value={rapor.tarih || "-"} />
            <Info label="Durum" value={rapor.durum || "-"} />
            <Info label="Önerilen Firma" value={rapor.onerilenFirma || "-"} />
          </div>
        </div>

          <button
            onClick={siparisOlustur}
            disabled={loading}
            className={`rounded-xl px-5 py-3 text-sm font-bold text-white ${
              loading
                ? "cursor-not-allowed bg-slate-400"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {loading ? "Sipariş Oluşturuluyor..." : "Sipariş Oluştur"}
          </button>

            <Link
              href={`/dashboard/raporlar/${id}/mukayese`}
              className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              Mukayese Raporu
            </Link>

            <Link
              href={`/dashboard/raporlar/${id}/son-alim`}
              className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
            >
              Son Alım
            </Link>
          </div>

          {message && (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
              {message}
            </div>
          )}
        </div>
  );
}

function Info({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="mt-1 font-bold text-slate-900">{value}</div>
    </div>
  );
}