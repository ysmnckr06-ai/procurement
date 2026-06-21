import { createBrowserClient } from "@supabase/ssr";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase;

if (typeof window !== "undefined") {
  if (!window.__supabase) {
    window.__supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  supabase = window.__supabase;
} else {
  supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };

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
