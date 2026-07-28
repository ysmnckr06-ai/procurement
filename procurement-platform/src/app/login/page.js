"use client";

import { useEffect, useState } from "react";
import {
  AuthButton,
  AuthCard,
  AuthInput,
  AuthShell,
  FieldIcon,
} from "@/components/AuthShell";
import { migrateLegacySupabaseSession, supabase } from "@/lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;

    async function migrateExistingSession() {
      const migrated = await migrateLegacySupabaseSession();
      if (mounted && migrated) window.location.href = "/dashboard";
    }

    migrateExistingSession();
    return () => {
      mounted = false;
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();

    if (loading) return;

    setLoading(true);
    setMessage("");

    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        setMessage(error.message);
        return;
      }

      setMessage("Giriş başarılı");
      window.location.href = "/dashboard";
    } catch (err) {
      console.error("LOGIN CATCH:", err);
      setMessage("Bağlantı hatası oluştu.");
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordReset = async () => {
    if (!email.trim()) {
      setMessage("Şifre sıfırlama bağlantısı için önce e-posta adresinizi girin.");
      return;
    }
    if (loading) return;

    setLoading(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw error;
      setMessage("Şifre sıfırlama bağlantısı e-posta adresinize gönderildi.");
    } catch (error) {
      console.error("PASSWORD RESET:", error);
      setMessage("Şifre sıfırlama bağlantısı gönderilemedi. Birkaç dakika sonra tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <AuthCard
        title="Tekrar hoş geldiniz"
        description="Hesabınıza giriş yaparak devam edin."
        footerPrompt="Hesabınız yok mu?"
        footerHref="/register"
        footerLabel="Kayıt Ol"
      >
        <form onSubmit={handleLogin} className="mt-8 space-y-5">
          <AuthInput
            id="login-email"
            label="E-posta adresiniz"
            type="email"
            placeholder="ornek@firma.com"
            value={email}
            onChange={setEmail}
            required
            autoComplete="email"
            icon={<FieldIcon type="mail" />}
          />

          <AuthInput
            id="login-password"
            label="Şifreniz"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            onChange={setPassword}
            required
            autoComplete="current-password"
            icon={<FieldIcon type="lock" />}
            rightElement={
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="ml-3 text-slate-500 transition hover:text-blue-700"
                aria-label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
              >
                <FieldIcon type={showPassword ? "eye-off" : "eye"} />
              </button>
            }
          />

          <div className="flex justify-end text-sm">
            <button
              type="button"
              onClick={handlePasswordReset}
              className="font-black text-blue-700 hover:text-blue-800"
            >
              Şifremi unuttum?
            </button>
          </div>

          <AuthButton loading={loading} loadingText="Giriş yapılıyor...">
            Giriş Yap
          </AuthButton>
        </form>

        {message && (
          <div
            className={`mt-5 rounded-xl border px-4 py-3 text-center text-sm font-bold ${
              message === "Giriş başarılı" || message.includes("gönderildi")
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : "border-red-200 bg-red-50 text-red-700"
            }`}
          >
            {message}
          </div>
        )}
      </AuthCard>
    </AuthShell>
  );
}
