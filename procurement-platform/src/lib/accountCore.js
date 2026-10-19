// Ekip desteği: kayıtların sahibi "hesap"tır (hesabı açan kişinin kimliği).
// Ekibe katılan kişi kendi kimliğiyle giriş yapar ama hesabın verisiyle çalışır.
// Sayfalar `user.id`'yi kayıt sahibi olarak kullandığı için, bu yardımcılar
// kullanıcı nesnesinin `id` alanına hesap kimliğini koyar; gerçek giriş
// kimliği `authId` alanında kalır. Tek kişilik hesaplarda ikisi aynıdır.

const cache = new Map();

export async function resolveAccount(client, user) {
  if (!user) return null;
  const cached = cache.get(user.id);
  if (cached && Date.now() - cached.at < 5 * 60 * 1000) return cached.value;
  const [{ data: accountId, error }, { data: member }] = await Promise.all([
    client.rpc("current_account_id"),
    client.from("account_members").select("account_id,role").eq("user_id", user.id).maybeSingle(),
  ]);
  // Migration henüz uygulanmamışsa (fonksiyon yok) eski davranış sürer.
  const value = {
    accountId: !error && accountId ? accountId : user.id,
    role: member ? member.role : "owner",
    isAdmin: !member || member.role === "admin",
  };
  cache.set(user.id, { at: Date.now(), value });
  return value;
}

export function clearAccountCache() {
  cache.clear();
}

function withAccount(user, account) {
  if (!user || !account) return user;
  return { ...user, id: account.accountId, authId: user.id, accountRole: account.role, isAccountAdmin: account.isAdmin };
}

export async function getAccountUser(client) {
  const result = await client.auth.getUser();
  const user = result?.data?.user;
  if (!user) return result;
  const account = await resolveAccount(client, user);
  return { ...result, data: { ...result.data, user: withAccount(user, account) } };
}

export async function getAccountSession(client) {
  const result = await client.auth.getSession();
  const session = result?.data?.session;
  if (!session?.user) return result;
  const account = await resolveAccount(client, session.user);
  return { ...result, data: { ...result.data, session: { ...session, user: withAccount(session.user, account) } } };
}
