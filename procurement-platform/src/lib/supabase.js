import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase;

if (typeof window !== "undefined") {
  if (!window.__supabase) {
    window.__supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
    installGetUserCache(window.__supabase);
  }
  supabase = window.__supabase;
} else {
  supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };

// Bir sayfa açılırken menü, tur, sayfa ve paneller ayrı ayrı auth.getUser() çağırıyor;
// her biri sunucuya ~300 ms'lik bir istek demek. Aynı oturum için sonucu 60 sn
// paylaşırız; oturum değişince (çıkış, yenileme, kullanıcı güncelleme) önbellek silinir.
function installGetUserCache(client) {
  const original = client.auth.getUser.bind(client.auth);
  let cache = null;
  client.auth.getUser = async (jwt) => {
    if (jwt) return original(jwt);
    const { data } = await client.auth.getSession();
    const token = data?.session?.access_token || "";
    if (!token) return original();
    const now = Date.now();
    if (cache && cache.token === token && now - cache.at < 60000) return cache.promise;
    const promise = original().then((result) => {
      if (result?.error && cache?.promise === promise) cache = null;
      return result;
    });
    cache = { token, at: now, promise };
    return promise;
  };
  client.auth.onAuthStateChange((event) => {
    if (event !== "INITIAL_SESSION") cache = null;
  });
}

export async function migrateLegacySupabaseSession() {
  if (typeof window === "undefined") return false;

  try {
    const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
    const storageKey = `sb-${projectRef}-auth-token`;
    const storedValue = window.localStorage.getItem(storageKey);
    if (!storedValue) return false;

    const decodedValue = storedValue.startsWith("base64-")
      ? window.atob(storedValue.slice("base64-".length))
      : storedValue;
    const legacySession = JSON.parse(decodedValue);
    if (!legacySession?.access_token || !legacySession?.refresh_token)
      return false;

    const { error } = await supabase.auth.setSession({
      access_token: legacySession.access_token,
      refresh_token: legacySession.refresh_token,
    });

    if (error) return false;
    window.localStorage.removeItem(storageKey);
    return true;
  } catch (error) {
    console.warn("Eski Supabase oturumu taşınamadı:", error);
    return false;
  }
}
