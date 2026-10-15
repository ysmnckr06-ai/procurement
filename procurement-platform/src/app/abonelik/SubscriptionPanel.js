"use client";

import { useRef, useState } from "react";
import { supabase } from "@/lib/supabase";

function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

const inputClass =
  "w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100";

// iyzico'nun döndürdüğü form içeriği <script> etiketleri içerir; innerHTML ile
// eklenen script çalışmadığı için her biri yeni bir script öğesi olarak eklenir.
function mountCheckoutForm(container, html) {
  container.innerHTML = "";
  const template = document.createElement("div");
  template.innerHTML = html;
  template.querySelectorAll("script").forEach((original) => {
    const script = document.createElement("script");
    Array.from(original.attributes).forEach((attribute) => script.setAttribute(attribute.name, attribute.value));
    script.text = original.text;
    document.body.appendChild(script);
  });
}

function CheckoutForm({ defaultCompanyName, email }) {
  const [form, setForm] = useState({
    name: "",
    surname: "",
    phone: "",
    identityNumber: "",
    companyName: defaultCompanyName,
    address: "",
    city: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [formShown, setFormShown] = useState(false);
  const checkoutRef = useRef(null);

  const update = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

  async function handleSubmit(event) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.checkoutFormContent) {
        throw new Error(data.error || "Ödeme formu açılamadı.");
      }
      setFormShown(true);
      mountCheckoutForm(checkoutRef.current, data.checkoutFormContent);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-6">
      {!formShown && (
        <form onSubmit={handleSubmit} className="space-y-4">
          <h3 className="text-base font-black text-slate-900">Fatura bilgileri</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ad *"><input required className={inputClass} value={form.name} onChange={update("name")} /></Field>
            <Field label="Soyad *"><input required className={inputClass} value={form.surname} onChange={update("surname")} /></Field>
            <Field label="Cep telefonu *" hint="Örn. 0532 123 45 67">
              <input required type="tel" className={inputClass} value={form.phone} onChange={update("phone")} />
            </Field>
            <Field label="TCKN veya VKN *" hint="Şahıs için 11, şirket için 10 hane">
              <input required inputMode="numeric" className={inputClass} value={form.identityNumber} onChange={update("identityNumber")} />
            </Field>
            <Field label="Firma adı" hint="Fatura firmaya kesilecekse">
              <input className={inputClass} value={form.companyName} onChange={update("companyName")} />
            </Field>
            <Field label="Şehir *"><input required className={inputClass} value={form.city} onChange={update("city")} /></Field>
          </div>
          <Field label="Fatura adresi *">
            <textarea required rows={2} className={inputClass} value={form.address} onChange={update("address")} />
          </Field>
          <p className="text-xs text-slate-500">Fatura ve ödeme bilgilendirmeleri {email} adresine gönderilir.</p>
          {error && <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-800">{error}</div>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-blue-600 p-3 text-sm font-black text-white hover:bg-blue-700 disabled:bg-slate-400"
          >
            {loading ? "Ödeme formu hazırlanıyor..." : "Ödemeye geç"}
          </button>
        </form>
      )}
      <div id="iyzipay-checkout-form" className="responsive" ref={checkoutRef} />
    </div>
  );
}

function ManagePanel({ status, periodEnd, renewalDate, cancelAtPeriodEnd, paymentFailed, priceLabel }) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [canceled, setCanceled] = useState(cancelAtPeriodEnd || status === "CANCELED");

  async function handleCancel() {
    if (loading) return;
    const confirmed = window.confirm(
      `Aboneliğiniz iptal edilsin mi? ${periodEnd} tarihine kadar kullanmaya devam edersiniz; verileriniz silinmez.`,
    );
    if (!confirmed) return;
    setLoading(true);
    setMessage("");
    const response = await fetch("/api/billing/cancel", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setMessage(data.error || "Abonelik iptal edilemedi.");
      return;
    }
    setCanceled(true);
    setMessage(`Aboneliğiniz iptal edildi. ${periodEnd} tarihine kadar erişiminiz devam eder.`);
  }

  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div>
      <h2 className="text-xl font-black text-slate-900">
        {canceled ? "Abonelik iptal edildi" : paymentFailed ? "Son ödeme alınamadı" : "Aboneliğiniz aktif"}
      </h2>
      <p className="mt-2 text-sm leading-6 text-slate-600">
        {canceled
          ? `Erişiminiz ${periodEnd} tarihine kadar sürer. Sonrasında verileriniz korunur; dilediğiniz zaman yeniden abone olabilirsiniz.`
          : paymentFailed
            ? `iyzico kartınızdan çekim yapamadı ve tekrar deneyecek. Erişiminiz ${periodEnd} tarihine kadar açık.`
            : `${priceLabel}. Sonraki ödeme: ${renewalDate || periodEnd}.`}
      </p>
      {message && <div className="mt-4 rounded-xl bg-slate-100 p-3 text-sm font-semibold text-slate-700">{message}</div>}
      <div className="mt-6 flex flex-wrap gap-3">
        <a href="/dashboard" className="rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white hover:bg-blue-700">Panele dön</a>
        {!canceled && (
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100 disabled:text-slate-400"
          >
            {loading ? "İptal ediliyor..." : "Aboneliği iptal et"}
          </button>
        )}
        <button type="button" onClick={handleSignOut} className="rounded-xl px-5 py-3 text-sm font-bold text-slate-500 hover:bg-slate-100">
          Çıkış yap
        </button>
      </div>
    </div>
  );
}

export function SignOutButton() {
  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }
  return (
    <button type="button" onClick={handleSignOut} className="rounded-xl border border-slate-700 px-4 py-2 text-sm font-bold text-slate-200 hover:bg-slate-800">
      Çıkış yap
    </button>
  );
}

export default function SubscriptionPanel(props) {
  if (props.mode === "manage") return <ManagePanel {...props} />;
  return <CheckoutForm {...props} />;
}
