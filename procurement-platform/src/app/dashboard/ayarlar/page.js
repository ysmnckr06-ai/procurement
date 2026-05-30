"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const defaultSettings = {
  company_name: "",
  tax_no: "",
  default_currency: "TRY",
  annual_interest_rate: 45,
  max_file_size_mb: 10,
  max_offer_files: 15,
  default_payment_term: "60 gün",
  risk_level: "Orta",
  approval_required: true,
  notify_email: "",
};

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState(defaultSettings);
  const [recordId, setRecordId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

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

    setMessage("Ayarlar kaydedildi.");
  }

  return (
    <div className="min-h-screen bg-slate-100">
      <main className="p-6">
        <div className="mx-auto max-w-5xl space-y-6">
          <div>
            <div className="inline-flex rounded-full bg-slate-200 px-4 py-2 text-sm font-bold text-slate-700">
              Sistem Ayarları
            </div>
            <h1 className="mt-3 text-4xl font-bold text-slate-900">Ayarlar</h1>
            <p className="mt-2 max-w-2xl text-sm text-slate-600">
              Şirket bilgileri, varsayılan analiz değerleri ve satınalma kurallarını yönetin.
            </p>
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
            <div className="mb-6">
              <h2 className="text-xl font-bold text-slate-900">Şirket Bilgileri</h2>
              <p className="mt-1 text-sm text-slate-500">
                Rapor ve sipariş ekranlarında kullanılacak temel bilgiler.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Şirket Adı"
                name="company_name"
                value={settings.company_name}
                onChange={handleChange}
              />
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
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <h2 className="text-xl font-bold text-slate-900">Analiz Varsayılanları</h2>
              <p className="mt-1 text-sm text-slate-500">
                Teklif değerlendirme ve dosya yükleme sınırları için başlangıç değerleri.
              </p>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
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
              <h2 className="text-xl font-bold text-slate-900">Onay ve Risk</h2>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
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
