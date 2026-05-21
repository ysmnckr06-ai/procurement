"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RaporDetayPage() {
  const params = useParams();
  const id = params.id;

  const [rapor, setRapor] = useState(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const loadReport = async () => {
      if (!id) return;

      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("id", id)
        .single();

      if (error || !data) {
        console.error(error);
        setMessage("Rapor bulunamadı.");
        return;
      }

      setRapor(data);
    };

    loadReport();
  }, [id]);

  function siparisOlustur() {
    setLoading(true);

    localStorage.setItem(
      "pendingOrder",
      JSON.stringify({
        company: rapor.onerilenFirma || rapor.recommended_firm || "",
        product:
          rapor.ad ||
          rapor.name ||
          rapor.file_name ||
          "Mukayese Raporu",
        quantity: 1,
        dueDate: "",
        reportId: rapor.id,
        reportName:
          rapor.ad ||
          rapor.name ||
          rapor.file_name ||
          "Mukayese Raporu",
      })
    );

    window.location.href = "/dashboard/siparisler";
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

  const raporAdi =
    rapor.ad || rapor.name || rapor.file_name || "Mukayese Raporu";

  const raporTarihi = rapor.created_at
    ? new Date(rapor.created_at).toLocaleString("tr-TR")
    : rapor.tarih || "-";

  const firma = rapor.onerilenFirma || rapor.recommended_firm || "-";

  return (
    <div className="min-h-screen bg-slate-100 p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Link href="/dashboard/raporlar" className="text-sm font-bold text-blue-700">
            ← Raporlara Dön
          </Link>

          <h1 className="mt-4 text-3xl font-bold text-slate-900">
            {raporAdi}
          </h1>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Info label="Tarih" value={raporTarihi} />
            <Info label="Durum" value={rapor.durum || "Bekliyor"} />
            <Info label="Önerilen Firma" value={firma} />
          </div>
        </div>

        <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <button
            onClick={siparisOlustur}
            disabled={loading}
            className={`rounded-xl px-5 py-3 text-sm font-bold text-white ${
              loading
                ? "cursor-not-allowed bg-slate-400"
                : "bg-green-600 hover:bg-green-700"
            }`}
          >
            {loading ? "Yönlendiriliyor..." : "Sipariş Oluştur"}
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
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
            {message}
          </div>
        )}
      </div>
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