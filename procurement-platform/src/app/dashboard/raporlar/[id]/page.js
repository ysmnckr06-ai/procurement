"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function RaporDetayPage() {
  const params = useParams();
  const id = params.id;

  const [rapor, setRapor] = useState(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const loadReport = async () => {
      if (!id) return;

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setMessage("Raporu görmek için giriş yapmanız gerekiyor.");
        return;
      }

      const { data, error } = await supabase
        .from("reports")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (error || !data) {
        console.error(error);
        setMessage(error?.message ? `Rapor yüklenemedi: ${error.message}` : "Rapor bulunamadı veya bu kayda erişim yetkiniz yok.");
        return;
      }

      setRapor(data);
    };

    loadReport();
  }, [id]);

  const raporAdi = useMemo(() => {
  if (!rapor) return "Rapor Detayı";

  const name =
    rapor.ad ||
    rapor.name ||
    rapor.file_name ||
    rapor.report_name ||
    "";

  if (!name || name === "undefined") {
    return "Karşılaştırma Raporu";
  }

  return name;
}, [rapor]);

  const raporTarihi = useMemo(() => {
    if (!rapor) return "-";

    return rapor.created_at
      ? new Date(rapor.created_at).toLocaleString("tr-TR")
      : rapor.tarih || rapor.date || "-";
  }, [rapor]);

  const raporNumarasi = useMemo(() => {
    if (!rapor?.id) return "-";
    return `RPR-${String(rapor.id).replaceAll("-", "").slice(0, 8).toUpperCase()}`;
  }, [rapor]);

  const analiz = useMemo(() => {
    if (!rapor) return null;

    return (
      rapor.analysis ||
      rapor.analiz ||
      rapor.data ||
      rapor.result ||
      rapor.report_data ||
      null
    );
  }, [rapor]);

const mukayeseRows = useMemo(() => {
  return rapor?.analysis || [];
}, [rapor]);

const sonAlimRows = useMemo(() => {
  return rapor?.analysis || [];
}, [rapor]);

    const firma =
      rapor?.onerilenFirma ||
      rapor?.onerilenfirma ||
      rapor?.recommended_firm ||
      rapor?.recommendedFirm ||
      analiz?.recommended_firm ||
      analiz?.onerilenFirma ||
      analiz?.onerilenfirma ||
      "-";

  const kararOzeti = useMemo(() => {
    if (!rapor) return [];

    const rawRows = Array.isArray(analiz)
      ? analiz
      : Array.isArray(analiz?.items)
        ? analiz.items
        : Array.isArray(analiz?.rows)
          ? analiz.rows
          : [];

    if (rawRows.length === 0) {
      return [
        "Rapor arşivde kayıtlı. Detay dosyası indirildiğinde mukayese satırları ve seçim hesabı incelenebilir.",
        firma !== "-"
          ? `${firma} önerilen firma olarak kaydedilmiş.`
          : "Önerilen firma bilgisi bu rapor kaydında bulunmuyor.",
      ];
    }

    return rawRows.slice(0, 5).map((row, index) => {
      const supplier =
        row.recommended_firm ||
        row.onerilenFirma ||
        row.firma ||
        row.supplier ||
        firma ||
        "Firma";
      const reason =
        row.reason ||
        row.gerekce ||
        row.explanation ||
        row.aciklama ||
        "fiyat, vade, termin ve risk kriterlerine göre avantajlı görünüyor";
      const amount =
        row.total ||
        row.netToplamTRY ||
        row.netToplam ||
        row.toplamTutar ||
        "";

      return `${index + 1}. ${supplier}: ${reason}${amount ? ` (tutar: ${amount})` : ""}.`;
    });
  }, [analiz, firma, rapor]);

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
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <Link href="/dashboard/raporlar" className="text-sm font-bold text-blue-700">
            ← Raporlara Dön
          </Link>

          <h1 className="mt-4 text-3xl font-bold text-slate-900">
            {raporAdi}
          </h1>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-4">
            <Info label="Tarih" value={raporTarihi} />
            <Info label="Durum" value={rapor.durum || rapor.status || "Hazır"} />
            <Info label="Önerilen Firma" value={firma} />
            <Info label="Rapor No" value={raporNumarasi} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SummaryCard
            title="Mukayese Raporu"
            description="Teklif karşılaştırma verileri"
            count={mukayeseRows.length}
            href={`/dashboard/raporlar/${id}/mukayese`}
            buttonText="Mukayese Aç"
          />

          <SummaryCard
            title="Son Alım"
            description="Geçmiş satın alma verileri"
            count={sonAlimRows.length}
            href={`/dashboard/raporlar/${id}/son-alim`}
            buttonText="Son Alım Aç"
          />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Karar Özeti</h2>
          <p className="mt-2 text-sm text-slate-500">
            Raporun hangi gerekçeyle bu sonuca yöneldiğini hızlı okumak için tutulur.
          </p>
          <div className="mt-4 space-y-3">
            {kararOzeti.map((item) => (
              <div
                key={item}
                className="rounded-xl bg-slate-50 p-4 text-sm font-semibold text-slate-700"
              >
                {item}
              </div>
            ))}
          </div>
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

function Info({ label, value, small = false }) {
  return (
    <div className="rounded-xl bg-slate-50 p-4">
      <div className="text-sm text-slate-500">{label}</div>
      <div
        className={`mt-1 font-bold text-slate-900 ${
          small ? "break-all text-xs" : ""
        }`}
      >
        {value || "-"}
      </div>
    </div>
  );
}

function SummaryCard({ title, description, count, href, buttonText }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <p className="mt-2 text-sm text-slate-500">{description}</p>

      <div className="mt-4 rounded-xl bg-slate-50 p-4">
        <div className="text-sm text-slate-500">Kayıt Sayısı</div>
        <div className="mt-1 text-3xl font-black text-slate-900">
          {count}
        </div>
      </div>

      <Link
        href={href}
        className="mt-5 inline-flex rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700"
      >
        {buttonText}
      </Link>
    </div>
  );
}
