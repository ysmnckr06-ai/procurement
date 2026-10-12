import { createClient } from "@supabase/supabase-js";

// Servis rolüyle çalışan Supabase istemcisi. Yalnız sunucu tarafı API
// route'larında, kullanıcı kimliği ayrıca doğrulandıktan sonra kullanılır.
export function createAdminSupabaseClient() {
  const url = String(process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
