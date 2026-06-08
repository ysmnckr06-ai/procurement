"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { fetchLiveTryRates } from "@/lib/liveCurrency";

const defaultSettings = {
  company_name: "",
  tax_no: "",
  default_currency: "TRY",
  base_currency: "TRY",
  usd_rate: 39.2,
  eur_rate: 42.8,
  gbp_rate: 41.2,
  exchange_rate_date: new Date().toISOString().slice(0, 10),
  annual_interest_rate: 45,
  max_file_size_mb: 10,
  max_offer_files: 15,
  default_payment_term: "60 gün",
  risk_level: "Orta",
  approval_required: true,
  notify_email: "",
};

function StatCard({ title, value, text }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="text-sm font-semibold text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-black text-slate-900">{value}</div>
      <div className="mt-1 text-sm text-slate-500">{text}</div>
    </div>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState(defaultSettings);
  const [recordId, setRecordId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [liveRateInfo, setLiveRateInfo] = useState(null);
  const [loadingRates, setLoadingRates] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", user.id)
      .limit(1);

    if (error) {
      console.error(error);
      setMessage("Ayarlar tablosu hazır değil. Kaydetme için company_settings tablosu gerekir.");
      setLoading(false);
      return;
    }

    if (data?.[0]) {
      setRecordId(data[0].id);
      setSettings({
        ...defaultSettings,
        ...data[0],
      });
    }

    setLoading(false);
  }

  function handleChange(event) {
    const { name, value, type, checked } = event.target;
    setSettings((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function loadLiveRates() {
    setLoadingRates(true);
    setMessage("");
    try {
      const live = await fetchLiveTryRates();
      setLiveRateInfo(live);
      setSettings((prev) => ({
        ...prev,
        usd_rate: Number(live.rates.USD || prev.usd_rate || 1).toFixed(4),
        eur_rate: Number(live.rates.EUR || prev.eur_rate || 1).toFixed(4),
        gbp_rate: Number(live.rates.GBP || prev.gbp_rate || 1).toFixed(4),
        exchange_rate_date: live.date || new Date().toISOString().slice(0, 10),
      }));
      setMessage("Canlı kurlar alındı. Kayıt/onay kuru olarak kullanmak için ayarları kaydedin.");
    } catch (error) {
      console.error(error);
      setMessage("Canlı kur alınamadı. Manuel kur alanlarını kullanabilirsiniz.");
    } finally {
      setLoadingRates(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setMessage("");

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      router.push("/login");
      return;
    }

    const payload = {
      user_id: user.id,
      company_name: settings.company_name.trim(),
      tax_no: settings.tax_no.trim(),
      default_currency: settings.default_currency,
      base_currency: settings.base_currency || settings.default_currency || "TRY",
      usd_rate: Number(settings.usd_rate || 1),
      eur_rate: Number(settings.eur_rate || 1),
      gbp_rate: Number(settings.gbp_rate || 1),
      exchange_rate_date: settings.exchange_rate_date || new Date().toISOString().slice(0, 10),
      annual_interest_rate: Number(settings.annual_interest_rate || 0),
      max_file_size_mb: Number(settings.max_file_size_mb || 10),
      max_offer_files: Number(settings.max_offer_files || 15),
      default_payment_term: settings.default_payment_term.trim(),
      risk_level: settings.risk_level,
      approval_required: Boolean(settings.approval_required),
      notify_email: settings.notify_email.trim(),
    };

    const request = recordId
      ? supabase.from("company_settings").update(payload).eq("id", recordId).eq("user_id", user.id)
      : supabase.from("company_settings").insert(payload);

    const { data, error } = await request.select("id").limit(1);

    if (error) {
      console.error(error);
      setMessage("Ayarlar kaydedilemedi. Supabase company_settings tablosunu kontrol edin.");
      return;
    }

    if (data?.[0]?.id) {
      setRecordId(data[0].id);
    }

    setMessage("Ayarlar kaydedildi. Yeni teklif ve siparişlerde bu değerler kullanılacak.");
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="p-6">
        <div className="mx-auto max-w-6xl space-y-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex rounded-full bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700">
                Sistem Ayarları
              </div>
              <h1 className="mt-3 text-4xl font-bold text-slate-900">Ayarlar</h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-600">
                Şirket bilgileri, varsayılan analiz değerleri ve satınalma kurallarını yönetin.
              </p>
            </div>
            <button
              type="button"
              onClick={loadSettings}
              className="rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-50"
            >
              Yenile
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            <StatCard title="Para Birimi" value={settings.default_currency} text="Sipariş varsayılanı" />
            <StatCard title="Ana Para" value={settings.base_currency || "TRY"} text="Finans raporu" />
            <StatCard title="Finansman" value={`%${settings.annual_interest_rate || 0}`} text="Teklif analizi" />
            <StatCard title="Teklif Limiti" value={settings.max_offer_files || 15} text="Maksimum dosya" />
            <StatCard title="Onay" value={settings.approval_required ? "Açık" : "Kapalı"} text="Sipariş kuralı" />
          </div>

          {message && (
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm font-semibold text-blue-900">
              {message}
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <SectionTitle
              title="Şirket Bilgileri"
              text="Rapor ve sipariş ekranlarında kullanılacak temel bilgiler."
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label="Şirket Adı" name="company_name" value={settings.company_name} onChange={handleChange} />
              <Input label="Vergi No" name="tax_no" value={settings.tax_no} onChange={handleChange} />
              <Input
                label="Bildirim E-postası"
                name="notify_email"
                type="email"
                value={settings.notify_email}
                onChange={handleChange}
              />
              <Select
                label="Varsayılan Para Birimi"
                name="default_currency"
                value={settings.default_currency}
                onChange={handleChange}
                options={["TRY", "USD", "EUR", "GBP"]}
              />
              <Select
                label="Ana Para Birimi"
                name="base_currency"
                value={settings.base_currency}
                onChange={handleChange}
                options={["TRY", "USD", "EUR", "GBP"]}
              />
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <SectionTitle
                title="Kur Bilgileri"
                text="Kayıt anındaki kurla ana para karşılığı sabitlenir."
              />
              <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="text-sm font-black text-blue-900">Canlı kur takibi</div>
                  <div className="mt-1 text-sm font-semibold text-blue-700">
                    Proje, sipariş ve ödeme kayıtlarında sabit kur saklanır; canlı kur farkı takip için gösterilir.
                  </div>
                  {liveRateInfo && (
                    <div className="mt-2 text-xs font-bold text-blue-800">
                      Kaynak: {liveRateInfo.source} · Tarih: {liveRateInfo.date}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={loadLiveRates}
                  disabled={loadingRates}
                  className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:bg-slate-300"
                >
                  {loadingRates ? "Alınıyor..." : "Canlı Kurları Al"}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="USD Kuru" name="usd_rate" type="number" value={settings.usd_rate} onChange={handleChange} />
                <Input label="EUR Kuru" name="eur_rate" type="number" value={settings.eur_rate} onChange={handleChange} />
                <Input label="GBP Kuru" name="gbp_rate" type="number" value={settings.gbp_rate} onChange={handleChange} />
                <Input label="Kur Tarihi" name="exchange_rate_date" type="date" value={settings.exchange_rate_date} onChange={handleChange} />
              </div>
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <SectionTitle
                title="Analiz Varsayılanları"
                text="Teklif değerlendirme ve dosya yükleme sınırları için başlangıç değerleri."
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input
                  label="Yıllık Finansman Oranı"
                  name="annual_interest_rate"
                  type="number"
                  value={settings.annual_interest_rate}
                  onChange={handleChange}
                />
                <Input
                  label="Maksimum Dosya Boyutu MB"
                  name="max_file_size_mb"
                  type="number"
                  value={settings.max_file_size_mb}
                  onChange={handleChange}
                />
                <Input
                  label="Maksimum Teklif Dosyası"
                  name="max_offer_files"
                  type="number"
                  value={settings.max_offer_files}
                  onChange={handleChange}
                />
                <Input
                  label="Varsayılan Vade"
                  name="default_payment_term"
                  value={settings.default_payment_term}
                  onChange={handleChange}
                />
              </div>
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <SectionTitle
                title="Onay ve Risk"
                text="Siparişe dönüşüm ve risk değerlendirmesi için operasyon kuralları."
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <Select
                  label="Varsayılan Risk Seviyesi"
                  name="risk_level"
                  value={settings.risk_level}
                  onChange={handleChange}
                  options={["Düşük", "Orta", "Yüksek", "Kritik"]}
                />
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    name="approval_required"
                    checked={settings.approval_required}
                    onChange={handleChange}
                  />
                  Sipariş oluşturmadan önce onay gerekli
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="submit"
                disabled={loading}
                className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300"
              >
                Ayarları Kaydet
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}

function SectionTitle({ title, text }) {
  return (
    <div className="mb-5">
      <h2 className="text-xl font-bold text-slate-900">{title}</h2>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}

function Input({ label, name, value, onChange, type = "text" }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
      />
    </label>
  );
}

function Select({ label, name, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
      >
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}
