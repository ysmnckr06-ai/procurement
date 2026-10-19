import { supabase as browserClient } from "@/lib/supabase";
import { getAccountSession as sessionFor, getAccountUser as userFor } from "@/lib/accountCore";

// Tarayıcı tarafı kısayollar; açıklama için lib/accountCore.js.
export { clearAccountCache, resolveAccount } from "@/lib/accountCore";

export function getAccountUser(client = browserClient) {
  return userFor(client);
}

export function getAccountSession(client = browserClient) {
  return sessionFor(client);
}
