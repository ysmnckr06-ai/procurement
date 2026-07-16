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
  accepted_termin_days: 15,
  daily_delay_cost_try: 0,
  missing_data_policy: "manual_review",
  critical_level: "medium",
  delay_impact: "medium",
  alternative_stock: "partial",
  shipping_included: "included",
  supplier_trust: "medium",
  quality_history: "unknown",
  currency_risk: "medium",
  max_file_size_mb: 10,
  max_offer_files: 15,
  default_payment_term: "60 gün",
  risk_level: "Orta",
  approval_required: true,
  notify_email: "",
};

function parsePositiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [liveRateInfo, setLiveRateInfo] = useState(null);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setLoading(false);
      router.push("/login");
      return;
    }

    const { data, error } = await supabase
      .from("company_settings")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error(error);
      setMessage("Ayarlar tablosu hazır değil. Kaydetme için company_settings tablosu gerekir.");
      setLoading(false);
      return;
    }

    const savedSettings = data?.[0] || null;

    let nextSettings = {
      ...defaultSettings,
      ...(savedSettings || {}),
      company_name:
        String(savedSettings?.company_name || "").trim() ||
        String(user.user_metadata?.company_name || "").trim(),
      tax_no:
        String(savedSettings?.tax_no || "").trim() ||
        String(user.user_metadata?.tax_no || "").trim(),
      notify_email:
        String(savedSettings?.notify_email || "").trim() ||
        String(user.email || "").trim(),
    };

    try {
      const live = await fetchLiveTryRates();
      setLiveRateInfo(live);
      nextSettings = {
        ...nextSettings,
        usd_rate: Number(live.rates.USD || nextSettings.usd_rate || 1).toFixed(4),
        eur_rate: Number(live.rates.EUR || nextSettings.eur_rate || 1).toFixed(4),
        gbp_rate: Number(live.rates.GBP || nextSettings.gbp_rate || 1).toFixed(4),
        exchange_rate_date: live.date || new Date().toISOString().slice(0, 10),
      };
    } catch (liveRateError) {
      console.error(liveRateError);
      setLiveRateInfo(null);
      setMessage("Canlı kur otomatik alınamadı. Sistem kayıtlı son geçerli kurları kullanacak.");
    }

    setSettings(nextSettings);

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

    const usdRate = parsePositiveNumber(settings.usd_rate);
    const eurRate = parsePositiveNumber(settings.eur_rate);
    const gbpRate = parsePositiveNumber(settings.gbp_rate);
    const maxFileSize = parsePositiveNumber(settings.max_file_size_mb);
    const maxOfferFiles = parsePositiveNumber(settings.max_offer_files);
    const annualInterestRate = Number(settings.annual_interest_rate);
    const acceptedTerminDays = Number(settings.accepted_termin_days);
    const dailyDelayCost = Number(settings.daily_delay_cost_try);
    const normalizedTaxNo = String(settings.tax_no || "").replace(/\D/g, "");

    if (!String(settings.company_name || "").trim()) {
      setMessage("Şirket adı zorunludur.");
      return;
    }

    if (!/^\d{10,11}$/.test(normalizedTaxNo)) {
      setMessage("Vergi numarası 10 veya 11 rakam olmalıdır.");
      return;
    }

    if (!usdRate || !eurRate || !gbpRate) {
      setMessage("Kur değerleri boş, 0, negatif veya geçersiz olamaz.");
      return;
    }

    if (!maxFileSize || !maxOfferFiles) {
      setMessage("Dosya limitleri 0'dan büyük olmalıdır.");
      return;
    }

    if (![annualInterestRate, acceptedTerminDays, dailyDelayCost].every((value) => Number.isFinite(value) && value >= 0)) {
      setMessage("Finansman oranı, kabul edilen termin ve gecikme maliyeti negatif veya geçersiz olamaz.");
      return;
    }

    const payload = {
      user_id: user.id,
      company_name: settings.company_name.trim(),
      tax_no: normalizedTaxNo,
      default_currency: settings.default_currency,
      base_currency: settings.base_currency || settings.default_currency || "TRY",
      usd_rate: usdRate,
      eur_rate: eurRate,
      gbp_rate: gbpRate,
      exchange_rate_date: settings.exchange_rate_date || new Date().toISOString().slice(0, 10),
      annual_interest_rate: annualInterestRate,
      accepted_termin_days: acceptedTerminDays,
      daily_delay_cost_try: dailyDelayCost,
      missing_data_policy: settings.missing_data_policy,
      critical_level: settings.critical_level,
      delay_impact: settings.delay_impact,
      alternative_stock: settings.alternative_stock,
      shipping_included: settings.shipping_included,
      supplier_trust: settings.supplier_trust,
      quality_history: settings.quality_history,
      currency_risk: settings.currency_risk,
      max_file_size_mb: maxFileSize,
      max_offer_files: maxOfferFiles,
      default_payment_term: settings.default_payment_term.trim(),
      risk_level: settings.risk_level,
      approval_required: Boolean(settings.approval_required),
      notify_email: settings.notify_email.trim(),
    };

    const { data, error } = await supabase
      .from("company_settings")
      .upsert(
        { ...payload, updated_at: new Date().toISOString() },
        { onConflict: "user_id" },
      )
      .select("*")
      .limit(1);

    if (error) {
      console.error(error);
      setMessage("Ayarlar kaydedilemedi. Supabase company_settings tablosunu kontrol edin.");
      return;
    }

    if (data?.[0]?.id) {
      setSettings({
        ...defaultSettings,
        ...data[0],
      });
    }

    const missingIdentityMetadata = {};
    if (!String(user.user_metadata?.company_name || "").trim() && payload.company_name) {
      missingIdentityMetadata.company_name = payload.company_name;
    }
    if (!String(user.user_metadata?.tax_no || "").trim() && payload.tax_no) {
      missingIdentityMetadata.tax_no = payload.tax_no;
    }
    if (Object.keys(missingIdentityMetadata).length > 0) {
      const { error: metadataError } = await supabase.auth.updateUser({ data: missingIdentityMetadata });
      if (metadataError) console.error(metadataError);
    }

    setMessage("Ayarlar kaydedildi. Yeni teklif ve siparişlerde bu değerler kullanılacak.");
    await loadSettings();
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
              onClick={() => {
                setMessage("");
                loadSettings();
              }}
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
              text="Firma adı ve vergi numarası kayıt sırasında kullanıcı hesabına bağlanır ve sonradan değiştirilemez."
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input
                label="Şirket Adı"
                name="company_name"
                value={settings.company_name}
                onChange={handleChange}
                readOnly={Boolean(String(settings.company_name || "").trim())}
                helpText={settings.company_name ? "Kayıt sırasında tanımlanan kalıcı firma bilgisidir." : "Eski hesapta eksik. Bir kez girilip kaydedildikten sonra değiştirilemez."}
              />
              <Input
                label="Vergi No"
                name="tax_no"
                value={settings.tax_no}
                onChange={handleChange}
                readOnly={Boolean(String(settings.tax_no || "").trim())}
                helpText={settings.tax_no ? "Kayıt sırasında tanımlanan kalıcı vergi bilgisidir." : "Eski hesapta eksik. 10 veya 11 rakam olarak bir kez girin."}
              />
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
                  <div className="text-sm font-black text-blue-900">Canlı kur takibi · Otomatik</div>
                  <div className="mt-1 text-sm font-semibold text-blue-700">
                    Güncel kurlar sayfa açıldığında otomatik alınır. Proje, sipariş ve ödeme kayıtlarında işlem anındaki kur ayrıca sabitlenir.
                  </div>
                  {liveRateInfo && (
                    <div className="mt-2 text-xs font-bold text-blue-800">
                      Kaynak: {liveRateInfo.source} · Tarih: {liveRateInfo.date}
                    </div>
                  )}
                </div>
                <div className="w-fit rounded-full bg-blue-600 px-4 py-2 text-xs font-black text-white">
                  Otomatik güncel
                </div>
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Input label="USD Kuru" name="usd_rate" type="number" min="0.000001" value={settings.usd_rate} onChange={handleChange} readOnly />
                <Input label="EUR Kuru" name="eur_rate" type="number" min="0.000001" value={settings.eur_rate} onChange={handleChange} readOnly />
                <Input label="GBP Kuru" name="gbp_rate" type="number" min="0.000001" value={settings.gbp_rate} onChange={handleChange} readOnly />
                <Input label="Kur Tarihi" name="exchange_rate_date" type="date" value={settings.exchange_rate_date} onChange={handleChange} readOnly />
              </div>
            </div>

            <div id="satinalma-politikasi" className="mt-8 scroll-mt-6 border-t border-slate-200 pt-6">
              <SectionTitle
                title="Satın Alma Karar Politikası"
                text="Şirketiniz bu değerleri bir kez tanımlar; teklif mukayeseleri otomatik olarak aynı politikayı kullanır."
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <Input
                  label="Yıllık Finansman / Fırsat Maliyeti (%)"
                  name="annual_interest_rate"
                  type="number"
                  min="0"
                  value={settings.annual_interest_rate}
                  onChange={handleChange}
                  helpText="Şirketin yıllık kredi veya sermaye fırsat maliyetidir. Finans biriminiz kesinleştirmediyse başlangıç için %45 kullanılabilir."
                />
                <Input
                  label="Kabul Edilen Termin (gün)"
                  name="accepted_termin_days"
                  type="number"
                  min="0"
                  value={settings.accepted_termin_days}
                  onChange={handleChange}
                  helpText="Bu süreden sonraki teslimatlar gecikme olarak değerlendirilir. Başlangıç önerisi: 15 gün."
                />
                <Input
                  label="Günlük Gecikme Maliyeti (TRY/gün)"
                  name="daily_delay_cost_try"
                  type="number"
                  min="0"
                  value={settings.daily_delay_cost_try}
                  onChange={handleChange}
                  helpText="Üretim kaybı, bekleyen ekip ve olası cezanın günlük tahminidir. 0 girilirse termin gecikmesi parasal olarak hesaplanmaz."
                />
              </div>

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <Select label="Eksik Vade / Termin Bilgisi" name="missing_data_policy" value={settings.missing_data_policy} onChange={handleChange} helpText="Teklifte vade veya termin yoksa sistemin davranışıdır. Güvenli başlangıç: otomatik önerme, incelemeye bırak." options={[{ value: "manual_review", label: "Otomatik önerme, incelemeye bırak" }, { value: "warn_only", label: "Uyar ama değerlendirmeye al" }]} />
                <Select label="Varsayılan Ürün Kritikliği" name="critical_level" value={settings.critical_level} onChange={handleChange} helpText="Ürün özelinde bilgi yoksa kullanılacak operasyon etkisidir. Başlangıç önerisi: Orta kritik." options={[{ value: "low", label: "Kritik değil" }, { value: "medium", label: "Orta kritik" }, { value: "high", label: "Üretimi etkiler" }, { value: "critical", label: "Operasyonu durdurabilir" }]} />
                <Select label="Varsayılan Geç Teslim Etkisi" name="delay_impact" value={settings.delay_impact} onChange={handleChange} helpText="Gecikmenin şirket operasyonuna etkisidir. Başlangıç önerisi: İş kaybı olabilir." options={[{ value: "none", label: "Etkilemez" }, { value: "low", label: "Düşük" }, { value: "medium", label: "İş kaybı olabilir" }, { value: "high", label: "Operasyon durabilir" }]} />
                <Select label="Varsayılan Alternatif Stok" name="alternative_stock" value={settings.alternative_stock} onChange={handleChange} helpText="Muadil veya yedek ürün erişimini belirtir. Başlangıç önerisi: Kısmen var." options={[{ value: "full", label: "Yeterli" }, { value: "partial", label: "Kısmen var" }, { value: "none", label: "Yok" }]} />
                <Select label="Varsayılan Nakliye Politikası" name="shipping_included" value={settings.shipping_included} onChange={handleChange} helpText="Tüm tekliflerde navlun kesin olarak dahil değilse Bilinmiyor seçmek daha güvenlidir." options={[{ value: "included", label: "Fiyata dahil" }, { value: "excluded", label: "Hariç" }, { value: "unknown", label: "Bilinmiyor" }]} />
                <Select label="Varsayılan Tedarikçi Güveni" name="supplier_trust" value={settings.supplier_trust} onChange={handleChange} helpText="Teslimat ve hizmet geçmişi yoksa Orta; yeni veya sorunlu tedarikçide Düşük seçin." options={[{ value: "high", label: "Yüksek" }, { value: "medium", label: "Orta" }, { value: "low", label: "Düşük / yeni" }]} />
                <Select label="Varsayılan Kalite Geçmişi" name="quality_history" value={settings.quality_history} onChange={handleChange} helpText="İade veya kalite kaydı yoksa Bilinmiyor seçin; tahmine dayalı olumlu puan verilmez." options={[{ value: "good", label: "Sorunsuz" }, { value: "medium", label: "Ara sıra sorun" }, { value: "bad", label: "Sık sorun" }, { value: "unknown", label: "Bilinmiyor" }]} />
                <Select label="Varsayılan Kur Riski" name="currency_risk" value={settings.currency_risk} onChange={handleChange} helpText="Dövizli teklifler için varsayılan risktir. Başlangıç önerisi: Orta; TRY tekliflere uygulanmaz." options={[{ value: "none", label: "Yok" }, { value: "low", label: "Düşük" }, { value: "medium", label: "Orta" }, { value: "high", label: "Yüksek" }]} />
              </div>

              <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold text-amber-900">
                Firma veya ürün bazında güvenilir veri yoksa sistem kesin karar vermek yerine kontrol uyarısı üretir.
              </div>
            </div>

            <div className="mt-8 border-t border-slate-200 pt-6">
              <SectionTitle title="Analiz Varsayılanları" text="Dosya yükleme sınırları ve rapor başlangıç değerleri." />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
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
                  helpText="Teklifte vade yazmıyorsa kullanılacak şirket standardıdır. Şirket politikanız buysa 60 gün bırakın."
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
                  helpText="Yeni kayıtlarda başlangıç riskidir. Genel kullanım için Orta uygundur."
                  options={["Düşük", "Orta", "Yüksek", "Kritik"]}
                />
                <label className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    name="approval_required"
                    checked={settings.approval_required}
                    onChange={handleChange}
                  />
                  <span>
                    Sipariş oluşturmadan önce onay gerekli
                    <span className="mt-1 block text-xs font-medium leading-5 text-slate-500">
                      Güvenli kullanım için açık bırakın; sistem önerisi doğrudan siparişe dönüşmez.
                    </span>
                  </span>
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

function Input({ label, name, value, onChange, type = "text", min, readOnly = false, helpText = "" }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <input
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        step={type === "number" ? "any" : undefined}
        min={min}
        readOnly={readOnly}
        className={`w-full rounded-xl border border-slate-300 p-3 text-sm ${readOnly ? "bg-slate-100 text-slate-600" : "bg-white"}`}
      />
      {helpText && <span className="mt-2 block text-xs font-medium leading-5 text-slate-500">{helpText}</span>}
    </label>
  );
}

function Select({ label, name, value, onChange, options, helpText = "" }) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-bold text-slate-700">{label}</span>
      <select
        name={name}
        value={value}
        onChange={onChange}
        className="w-full rounded-xl border border-slate-300 p-3 text-sm"
      >
        {options.map((item) => {
          const option = typeof item === "string" ? { value: item, label: item } : item;
          return <option key={option.value} value={option.value}>{option.label}</option>;
        })}
      </select>
      {helpText && <span className="mt-2 block text-xs font-medium leading-5 text-slate-500">{helpText}</span>}
    </label>
  );
}
