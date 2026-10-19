"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { clearAccountCache } from "@/lib/account";

// Ekip daveti: davet edilen kişi kendi hesabıyla giriş yapıp daveti kabul eder.
export default function InvitationPage({ params }) {
  const { token } = use(params);
  const [state, setState] = useState({ loading: true, email: "", error: "", done: false });

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setState((prev) => ({ ...prev, loading: false, email: data?.user?.email || "" }));
    });
  }, []);

  async function accept() {
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    const { error } = await supabase.rpc("accept_account_invitation", { p_token: token });
    clearAccountCache();
    if (error) {
      setState((prev) => ({ ...prev, loading: false, error: error.message }));
      return;
    }
    setState((prev) => ({ ...prev, loading: false, done: true }));
    setTimeout(() => { window.location.href = "/dashboard"; }, 1200);
  }

  const next = encodeURIComponent(`/davet/${token}`);
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-black text-slate-900">Ekip daveti</h1>
        <p className="mt-2 text-sm text-slate-600">
          Bir CORVIAN hesabının ekibine davet edildiniz. Kabul ettiğinizde o hesabın stok, proje, talep ve siparişleriyle çalışırsınız.
        </p>
        {state.loading ? (
          <p className="mt-6 text-sm font-bold text-slate-500">Yükleniyor...</p>
        ) : state.done ? (
          <p role="status" className="mt-6 rounded-xl bg-emerald-50 p-3 text-sm font-bold text-emerald-800">Ekibe katıldınız. Panele yönlendiriliyorsunuz...</p>
        ) : state.email ? (
          <>
            <p className="mt-6 text-sm text-slate-600">Giriş yapan: <b>{state.email}</b></p>
            {state.error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm font-bold text-red-800">{state.error}</p>}
            <button type="button" onClick={accept} className="mt-4 w-full rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800">
              Daveti kabul et
            </button>
          </>
        ) : (
          <div className="mt-6 grid gap-3">
            <p className="text-sm text-slate-600">Daveti kabul etmek için davetin gönderildiği e-posta adresiyle giriş yapın. Hesabınız yoksa önce kayıt olun, sonra bu bağlantıyı yeniden açın.</p>
            <Link href={`/login?next=${next}`} className="rounded-xl bg-slate-900 px-5 py-3 text-center text-sm font-bold text-white">Giriş yap</Link>
            <Link href="/register" className="rounded-xl border border-slate-300 px-5 py-3 text-center text-sm font-bold text-slate-700">Kayıt ol</Link>
          </div>
        )}
      </div>
    </main>
  );
}
