// Supabase server client — uses the publishable (anon) key but reads
// the user's cookies so RLS sees the authenticated user.
//
// Usage in API routes / server components:
//   import { createSupabaseServerClient } from "@/lib/supabase/server";
//   const supabase = await createSupabaseServerClient();
//   const { data: { user } } = await supabase.auth.getUser();

import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!;
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method was called from a Server Component — safe to ignore
          // because the middleware will refresh the session.
        }
      },
    },
  });
}

// Admin client — bypasses RLS. ONLY import this in API routes that need
// admin privileges (seeding, bulk operations). Requires SUPABASE_SERVICE_ROLE_KEY.
// Falls back to the anon client if service role key isn't set.
export function createSupabaseAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    console.warn(
      "[supabase/admin] SUPABASE_SERVICE_ROLE_KEY not set — falling back to anon client. " +
      "Admin operations will be subject to RLS and likely fail."
    );
    return createBrowserClient(url, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

