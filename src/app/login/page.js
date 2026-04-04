"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      setMessage("Giriş hatası: " + error.message);
      setLoading(false);
      return;
    }

    if (!data?.user) {
      setMessage("Kullanıcı bilgisi alınamadı.");
      setLoading(false);
      return;
    }

    setMessage("Giriş başarılı! Dashboard sayfasına yönlendiriliyorsunuz...");
    router.push("/dashboard");
    router.refresh();
  };

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-white shadow-md rounded-2xl p-8">
        <h1 className="text-3xl font-bold text-slate-800 text-center">
          Giriş Yap
        </h1>

        <p className="mt-3 text-slate-600 text-center">
          Hesabınıza giriş yaparak platforma devam edin.
        </p>

        <form onSubmit={handleLogin} className="mt-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              E-posta
            </label>
            <input
              type="email"
              placeholder="ornek@mail.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-slate-400"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Şifre
            </label>
            <input
              type="password"
              placeholder="Şifrenizi girin"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-slate-300 rounded-xl p-3 outline-none focus:ring-2 focus:ring-slate-400"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-slate-800 text-white rounded-xl p-3 hover:bg-slate-700 disabled:opacity-60"
          >
            {loading ? "Giriş yapılıyor..." : "Giriş Yap"}
          </button>
        </form>

        {message && (
          <p className="mt-4 text-center text-sm text-slate-700">{message}</p>
        )}

        <p className="mt-6 text-center text-sm text-slate-600">
          Hesabınız yok mu?{" "}
          <Link href="/register" className="font-semibold text-slate-800">
            Kayıt Ol
          </Link>
        </p>
      </div>
    </main>
  );
}