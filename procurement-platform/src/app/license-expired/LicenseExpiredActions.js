"use client";

import { supabase } from "@/lib/supabase";

export default function LicenseExpiredActions({ email, whatsapp }) {
  async function handleSignOut() {
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  const whatsappDigits = String(whatsapp || "").replace(/\D/g, "");
  const hasWhatsapp = whatsappDigits.length >= 10;

  return (
    <div className="mt-8 grid gap-3 sm:grid-cols-2">
      {hasWhatsapp
        ? <a
            href={`https://wa.me/${whatsappDigits}?text=${encodeURIComponent("CORVIAN lisansımı yenilemek istiyorum.")}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl bg-emerald-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-emerald-700"
          >
            WhatsApp ile iletişim
          </a>
        : <div className="rounded-xl bg-slate-100 px-5 py-3 text-center text-sm font-semibold text-slate-500">
            WhatsApp: {whatsapp || "Satış ekibi"}
          </div>}
      <a
        href={`mailto:${email}?subject=${encodeURIComponent("CORVIAN lisans yenileme")}`}
        className="rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white hover:bg-blue-700"
      >
        {email}
      </a>
      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-xl border border-slate-300 px-5 py-3 text-sm font-bold text-slate-700 hover:bg-slate-100 sm:col-span-2"
      >
        Çıkış yap
      </button>
    </div>
  );
}
