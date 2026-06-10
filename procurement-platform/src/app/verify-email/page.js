"use client";

import { Suspense, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

function VerifyEmailContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialEmail = searchParams.get("email") || "";

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleVerify(e) {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setMessage("");

    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: code.trim(),
      type: "signup",
    });

    if (error) {
      setMessage("Kod doğrulanamadı. Lütfen maildeki kodu kontrol edin.");
      setLoading(false);
      return;
    }

    setMessage("Hesap doğrulandı. Dashboard'a yönlendiriliyorsunuz...");

    setTimeout(() => {
      router.push("/dashboard");
    }, 800);
  }

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="grid w-full max-w-5xl grid-cols-1 overflow-hidden rounded-3xl bg-white shadow-2xl md:grid-cols-2">
        <section className="hidden bg-slate-900 p-10 text-white md:block">
          <div className="text-sm font-bold text-blue-300">Nitirio</div>

          <h1 className="mt-6 text-4xl font-black leading-tight">
            E-posta doğrulama
          </h1>

          <p className="mt-4 text-sm leading-6 text-slate-300">
            Güvenli kullanım için hesabınızı doğruluyoruz. Mail adresinize gelen
            kodu girerek platforma devam edebilirsiniz.
          </p>

          <div className="mt-8 space-y-3 text-sm text-slate-200">
            <div>✓ Teklif ve mukayese raporları</div>
            <div>✓ Sipariş ve stok takibi</div>
            <div>✓ Proje bazlı finans kontrolü</div>
          </div>
        </section>

        <section className="p-8 md:p-10">
          <div className="mb-8">
            <h2 className="text-3xl font-black text-slate-900">
              Doğrulama kodu
            </h2>

            <p className="mt-2 text-sm text-slate-500">
              Mail adresinize gelen doğrulama kodunu girin.
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-4">
            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-700">
                E-posta
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ornek@mail.com"
                required
                className="w-full rounded-xl border border-slate-300 p-3 text-sm outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-bold text-slate-700">
                Kod
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="00000000"
                maxLength={8}
                required
                className="w-full rounded-xl border border-slate-300 p-3 text-center text-2xl font-black tracking-[0.35em] outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              />
            </label>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-slate-900 p-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-400"
            >
              {loading ? "Doğrulanıyor..." : "Hesabı Doğrula"}
            </button>
          </form>

          {message && (
            <div className="mt-4 rounded-xl bg-slate-100 p-3 text-center text-sm font-semibold text-slate-700">
              {message}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="p-6">Yükleniyor...</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}