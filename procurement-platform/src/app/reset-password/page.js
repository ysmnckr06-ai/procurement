"use client";

import { useState } from "react";
import { AuthButton, AuthCard, AuthInput, AuthShell, FieldIcon } from "@/components/AuthShell";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();
    if (password.length < 8) {
      setMessage("Yeni şifreniz en az 8 karakter olmalıdır.");
      return;
    }
    if (password !== confirmPassword) {
      setMessage("Şifreler birbiriyle eşleşmiyor.");
      return;
    }

    setLoading(true);
    setMessage("");
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.auth.signOut();
      window.location.href = "/login?passwordUpdated=1";
    } catch (error) {
      console.error("PASSWORD UPDATE:", error);
      setMessage("Bağlantının süresi dolmuş olabilir. Giriş ekranından yeni bağlantı isteyin.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard
        title="Yeni şifrenizi belirleyin"
        description="E-postanıza gelen güvenli bağlantı üzerinden yeni şifrenizi oluşturun."
        footerPrompt="Bağlantınız geçersiz mi?"
        footerHref="/login"
        footerLabel="Yeni bağlantı isteyin"
      >
        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <AuthInput
            id="new-password"
            label="Yeni şifre"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            minLength={8}
            required
            icon={<FieldIcon type="lock" />}
          />
          <AuthInput
            id="confirm-new-password"
            label="Yeni şifre tekrarı"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            minLength={8}
            required
            icon={<FieldIcon type="lock" />}
          />
          {message && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-bold text-red-700">
              {message}
            </div>
          )}
          <AuthButton loading={loading} loadingText="Şifre güncelleniyor...">
            Şifreyi güncelle
          </AuthButton>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
