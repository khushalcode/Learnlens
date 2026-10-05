// Supabase browser client — uses the publishable (anon) key.
// Subject to Row-Level Security policies defined in supabase-schema.sql.
//
// Usage in 'use client' files:
//   import { supabaseBrowser } from "@/lib/supabase/browser";
//   const { data } = await supabaseBrowser.from("profiles").select("*");

import { createBrowserClient } from "@supabase/ssr";

export function createSupabaseBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — check .env"
    );
  }
  return createBrowserClient(url, key);
}

// Singleton — re-use across client components
let _client: ReturnType<typeof createBrowserClient> | null = null;
export function supabaseBrowser() {
  if (!_client) _client = createSupabaseBrowserClient();
  return _client;
}
