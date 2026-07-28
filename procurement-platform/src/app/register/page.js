"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import {
  AuthButton,
  AuthCard,
  AuthInput,
  AuthShell,
  FieldIcon,
} from "@/components/AuthShell";
import { supabase } from "@/lib/supabase";

function PasswordToggle({ visible, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="ml-3 text-slate-500 transition hover:text-blue-700"
    >
      <FieldIcon type={visible ? "eye-off" : "eye"} />
    </button>
  );
}

function getPasswordStrength(password) {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (/[A-ZÇĞİÖŞÜ]/.test(password) && /[a-zçğıöşü]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9ÇĞİÖŞÜçğıöşü]/.test(password)) score += 1;

  if (score <= 1) return { label: "Zayıf", color: "bg-red-500", active: 1 };
  if (score === 2) return { label: "Orta", color: "bg-amber-500", active: 2 };
  if (score === 3) return { label: "İyi", color: "bg-blue-500", active: 3 };
  return { label: "Güçlü", color: "bg-emerald-500", active: 4 };
}

export default function RegisterPage() {
  const router = useRouter();

  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState("error");

  const passwordStrength = useMemo(
    () => getPasswordStrength(password),
    [password],
  );

  const handleRegister = async (event) => {
    event.preventDefault();
    setMessage("");

    if (password !== confirmPassword) {
      setMessageType("error");
      setMessage("Şifreler eşleşmiyor.");
      return;
    }

    setLoading(true);

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName.trim(),
          company_name: companyName.trim(),
        },
      },
    });

    if (error) {
      setMessageType("error");

      if (
        error.message.toLowerCase().includes("already") ||
        error.message.toLowerCase().includes("registered")
      ) {
        setMessage("Bu e-posta adresi zaten kayıtlı. Lütfen giriş yapın.");
      } else {
        setMessage(`Kayıt hatası: ${error.message}`);
      }

      setLoading(false);
      return;
    }

    setMessageType("success");
    setMessage(
      "Kayıt başarılı! E-posta doğrulama sayfasına yönlendiriliyorsunuz...",
    );

    setTimeout(() => {
      router.push(`/verify-email?email=${encodeURIComponent(email.trim())}`);
    }, 800);
  };

  return (
    <AuthShell>
      <AuthCard
        title="14 günlük ücretsiz demonuzu başlatın"
        description="CORVIAN çalışma alanınızı oluşturun. Kredi kartı gerekmez; deneme süreniz kayıt işlemi tamamlandığında başlar."
        footerHref="/login"
        footerPrompt="Zaten hesabınız var mı?"
        footerLabel="Giriş Yap"
      >
        <form onSubmit={handleRegister} className="mt-8 space-y-5">
          <div className="grid gap-5 md:grid-cols-2">
            <AuthInput
              id="fullName"
              label="Ad Soyad"
              value={fullName}
              onChange={setFullName}
              placeholder="Adınız Soyadınız"
              autoComplete="name"
              required
              icon={<FieldIcon type="user" />}
            />

            <AuthInput
              id="companyName"
              label="Firma Adı"
              value={companyName}
              onChange={setCompanyName}
              placeholder="Firma adınız"
              autoComplete="organization"
              required
              icon={<FieldIcon type="building" />}
            />
          </div>

          <div>
            <AuthInput
              id="email"
              label="E-posta adresiniz"
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="ornek@firma.com"
              autoComplete="email"
              required
              icon={<FieldIcon type="mail" />}
            />
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <AuthInput
              id="password"
              label="Şifreniz"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={setPassword}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              icon={<FieldIcon type="lock" />}
              rightElement={
                <PasswordToggle
                  visible={showPassword}
                  onClick={() => setShowPassword((value) => !value)}
                  label={showPassword ? "Şifreyi gizle" : "Şifreyi göster"}
                />
              }
            />

            <AuthInput
              id="confirmPassword"
              label="Şifre Tekrarı"
              type={showConfirmPassword ? "text" : "password"}
              value={confirmPassword}
              onChange={setConfirmPassword}
              placeholder="••••••••"
              autoComplete="new-password"
              required
              icon={<FieldIcon type="lock" />}
              rightElement={
                <PasswordToggle
                  visible={showConfirmPassword}
                  onClick={() => setShowConfirmPassword((value) => !value)}
                  label={
                    showConfirmPassword
                      ? "Şifre tekrarını gizle"
                      : "Şifre tekrarını göster"
                  }
                />
              }
            />
          </div>

          <div>
            <div className="mb-2 text-sm font-bold text-slate-700">
              Şifre güvenliği:{" "}
              <span className="text-amber-600">
                {password ? passwordStrength.label : "Bekleniyor"}
              </span>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {[1, 2, 3, 4].map((step) => (
                <div
                  key={step}
                  className={`h-1.5 rounded-full ${
                    password && step <= passwordStrength.active
                      ? passwordStrength.color
                      : "bg-slate-200"
                  }`}
                />
              ))}
            </div>
          </div>

          {message && (
            <div
              className={`rounded-xl border px-4 py-3 text-sm font-bold ${
                messageType === "success"
                  ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : "border-red-200 bg-red-50 text-red-700"
              }`}
            >
              {message}
            </div>
          )}

          <p className="text-center text-xs font-semibold leading-5 text-slate-500">
            Kayıt olarak{" "}
            <Link
              href="/kullanim-sartlari"
              className="text-blue-700 hover:underline"
            >
              Kullanım Şartları
            </Link>
            ,{" "}
            <Link
              href="/gizlilik-politikasi"
              className="text-blue-700 hover:underline"
            >
              Gizlilik Politikası
            </Link>{" "}
            ve{" "}
            <Link href="/kvkk" className="text-blue-700 hover:underline">
              KVKK Aydınlatma Metni
            </Link>
            'ni kabul edersiniz.
          </p>

          <AuthButton loading={loading} loadingText="Kayıt oluşturuluyor...">
            14 Günlük Ücretsiz Denemeyi Başlat
          </AuthButton>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
