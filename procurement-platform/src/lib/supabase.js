import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let supabase;

if (typeof window !== "undefined") {
  if (!window.__supabase) {
    window.__supabase = createClient(supabaseUrl, supabaseAnonKey);
  }
  supabase = window.__supabase;
} else {
  supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };