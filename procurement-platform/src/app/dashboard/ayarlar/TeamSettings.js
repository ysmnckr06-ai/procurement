"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { clearAccountCache, getAccountUser } from "@/lib/account";

// Ayarlar → Ekip: hesabı en fazla 5 kişi kullanır (sahip dahil).
// Yönetici: davet eder, üye çıkarır, rol değiştirir, aboneliği yönetir.
// Kullanıcı: günlük işlerin hepsini yapar.
const SEAT_LIMIT = 5;
const ROLE_LABEL = { owner: "Hesap sahibi", admin: "Yönetici", member: "Kullanıcı" };

export default function TeamSettings() {
  const [me, setMe] = useState(null);
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");
  const [message, setMessage] = useState("");
  const [lastLink, setLastLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function load() {
    clearAccountCache();
    const {
      data: { user },
    } = await getAccountUser();
    if (!user) return;
    setMe(user);
    const [memberRes, inviteRes] = await Promise.all([
      supabase.from("account_members").select("user_id,role,email,created_at").order("created_at"),
      user.isAccountAdmin
        ? supabase.from("account_invitations").select("id,email,role,token,expires_at,accepted_at").is("accepted_at", null).order("created_at")
        : Promise.resolve({ data: [] }),
    ]);
    if (memberRes.error) {
      setUnavailable(true);
      return;
    }
    setMembers(memberRes.data || []);
    setInvites((inviteRes.data || []).filter((invite) => new Date(invite.expires_at) > new Date()));
  }

  useEffect(() => {
    load();
  }, []);

  const inviteLink = (token) => `${window.location.origin}/davet/${token}`;
  const used = 1 + members.length + invites.length;

  async function invite(event) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    const { data, error } = await supabase.rpc("create_account_invitation", { p_email: email, p_role: role });
    setBusy(false);
    if (error) {
      setMessage(error.message);
      return;
    }
    const link = inviteLink(data.token);
    setLastLink(link);
    setEmail("");
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Davet bağlantısı oluşturuldu ve kopyalandı. Bağlantıyı davet ettiğiniz kişiye gönderin; 7 gün geçerlidir.");
    } catch {
      setMessage("Davet bağlantısı oluşturuldu. Aşağıdaki bağlantıyı kopyalayıp davet ettiğiniz kişiye gönderin; 7 gün geçerlidir.");
    }
    await load();
  }

  async function act(fn, args, done) {
    setBusy(true);
    const { error } = await supabase.rpc(fn, args);
    setBusy(false);
    setMessage(error ? error.message : done);
    await load();
  }

  async function cancelInvite(id) {
    setBusy(true);
    const { error } = await supabase.from("account_invitations").delete().eq("id", id);
    setBusy(false);
    setMessage(error ? error.message : "Davet iptal edildi.");
    await load();
  }

  async function leave() {
    if (!window.confirm("Ekipten ayrılırsanız bu hesabın verilerine erişiminiz kapanır. Devam edilsin mi?")) return;
    await act("leave_account", {}, "Ekipten ayrıldınız.");
    window.location.href = "/dashboard";
  }

  if (!me || unavailable) return null;
  const isAdmin = me.isAccountAdmin;
  const isMember = me.accountRole !== "owner";

  return (
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" data-testid="team-settings">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Ekip</h2>
          <p className="mt-1 text-sm text-slate-500">
            Bu hesabı en fazla {SEAT_LIMIT} kişi kullanabilir (hesap sahibi dahil). Herkes aynı stok, proje, talep ve siparişleri görür.
          </p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-bold text-slate-700">{used}/{SEAT_LIMIT} kişi</span>
      </div>

      {message && <div role="status" className="mb-4 rounded-xl bg-slate-100 p-3 text-sm font-bold text-slate-700">{message}</div>}
      {lastLink && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm">
          <div className="font-bold text-emerald-900">Davet bağlantısı</div>
          <input readOnly value={lastLink} onFocus={(e) => e.target.select()} className="mt-2 w-full rounded-lg border border-emerald-200 bg-white p-2 text-xs" data-testid="team-invite-link" />
        </div>
      )}

      <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        <Row
          name={isMember ? "Hesap sahibi" : `${me.email} (siz)`}
          role="owner"
        />
        {members.map((member) => (
          <Row
            key={member.user_id}
            name={`${member.email || member.user_id}${member.user_id === me.authId ? " (siz)" : ""}`}
            role={member.role}
            actions={isAdmin && member.user_id !== me.authId && (
              <>
                <select
                  value={member.role}
                  disabled={busy}
                  onChange={(e) => act("set_account_member_role", { p_user_id: member.user_id, p_role: e.target.value }, "Rol güncellendi.")}
                  className="rounded-lg border border-slate-300 p-1.5 text-xs"
                  aria-label={`${member.email} rolü`}
                >
                  <option value="member">Kullanıcı</option>
                  <option value="admin">Yönetici</option>
                </select>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => window.confirm(`${member.email} ekipten çıkarılsın mı?`) && act("remove_account_member", { p_user_id: member.user_id }, "Üye ekipten çıkarıldı.")}
                  className="rounded-lg border border-red-200 px-2 py-1.5 text-xs font-bold text-red-700 hover:bg-red-50"
                >
                  Çıkar
                </button>
              </>
            )}
          />
        ))}
        {invites.map((invite) => (
          <Row
            key={invite.id}
            name={`${invite.email} · davet bekliyor`}
            role={invite.role}
            muted
            actions={isAdmin && (
              <>
                <button type="button" onClick={() => { setLastLink(inviteLink(invite.token)); setMessage("Davet bağlantısı aşağıda."); }} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-bold text-slate-700">
                  Bağlantı
                </button>
                <button type="button" disabled={busy} onClick={() => cancelInvite(invite.id)} className="rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-bold text-slate-700">
                  İptal
                </button>
              </>
            )}
          />
        ))}
      </div>

      {isAdmin ? (
        <form onSubmit={invite} className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <label className="block">
            <span className="sr-only">Davet e-postası</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ornek@firma.com"
              className="w-full rounded-xl border border-slate-300 p-3 text-sm"
              aria-label="Davet e-postası"
            />
          </label>
          <select value={role} onChange={(e) => setRole(e.target.value)} className="rounded-xl border border-slate-300 p-3 text-sm" aria-label="Davet rolü">
            <option value="member">Kullanıcı</option>
            <option value="admin">Yönetici</option>
          </select>
          <button type="submit" disabled={busy || used >= SEAT_LIMIT} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white hover:bg-slate-800 disabled:bg-slate-300">
            Davet et
          </button>
          {used >= SEAT_LIMIT && <p className="text-xs font-bold text-amber-700 sm:col-span-3">Ekip dolu. Yeni kişi için bir üyeyi çıkarın veya bekleyen daveti iptal edin.</p>}
        </form>
      ) : (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-500">
          <span>Ekibe kişi eklemek için hesap yöneticisine başvurun.</span>
          {isMember && (
            <button type="button" onClick={leave} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">
              Ekipten ayrıl
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function Row({ name, role, actions, muted = false }) {
  return (
    <div className={`flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm ${muted ? "bg-slate-50" : ""}`}>
      <div className="min-w-0">
        <div className={`truncate font-bold ${muted ? "text-slate-500" : "text-slate-900"}`}>{name}</div>
        <div className="text-xs font-semibold text-slate-500">{ROLE_LABEL[role] || role}</div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
