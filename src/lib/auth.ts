// NextAuth configuration — credentials provider backed by Supabase auth.
//
// The authorize callback calls supabase.auth.signInWithPassword(email, password)
// to verify the password (Supabase auth manages password hashing, not us).
// On success it fetches the user's profile row (role, name) from the
// profiles table — that's what becomes the NextAuth user object.
//
// We use the cookie-aware createSupabaseServerClient() for signInWithPassword
// so the resulting auth cookies get set on the response — this way later
// server-side calls that use createSupabaseServerClient() will see the
// Supabase auth session and respect RLS.
//
// For the profile lookup, we use createSupabaseAdminClient() because the
// requester (NextAuth) isn't yet logged in as a Supabase user — RLS would
// block the lookup if we used the server client at that point.
//
// The rest of the NextAuth config (JWT session, callbacks.jwt, callbacks.session,
// custom pages) is preserved unchanged so the front-end AuthProvider + dashboards
// keep working identically.

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase/server";

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      name: "LearnLens",
      credentials: {
        email: { label: "Email", type: "email", placeholder: "you@learnlens.edu" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.toLowerCase().trim();

        try {
          // 1) Verify the password with Supabase auth.
          //    We use the cookie-aware server client so the auth cookies get
          //    set on the response (preserves the Supabase session for later).
          const supabaseServer = await createSupabaseServerClient();
          const { data: signInData, error: signInError } =
            await supabaseServer.auth.signInWithPassword({
              email,
              password: credentials.password,
            });

          if (signInError || !signInData?.user) {
            // signIn failed — wrong password, no user, etc.
            return null;
          }

          // 2) Fetch the profile row to get role + display name.
          //    Use admin client here: the server-client cookies haven't fully
          //    propagated yet (this is still inside the authorize callback,
          //    pre-response), so RLS might not see the user yet. Bypassing
          //    RLS for the lookup is safe — we already verified the password.
          const supabaseAdmin = createSupabaseAdminClient();
          const { data: profile, error: profileError } = await supabaseAdmin
            .from("profiles")
            .select("id, email, name, role")
            .eq("id", signInData.user.id)
            .maybeSingle();

          if (profileError || !profile) {
            // Profile row missing — fall back to auth user's metadata.
            return {
              id: signInData.user.id,
              email: signInData.user.email ?? email,
              name:
                (signInData.user.user_metadata?.name as string | undefined) ??
                email.split("@")[0],
              role: "STUDENT",
            } as any;
          }

          return {
            id: profile.id,
            email: profile.email ?? email,
            name: profile.name ?? email.split("@")[0],
            role: profile.role,
          } as any;
        } catch (err) {
          console.error("[auth.authorize] Supabase auth failed:", err);
          return null;
        }
      },
    }),
  ],
  session: { strategy: "jwt" },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as any).id;
        token.role = (user as any).role;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as any).id = token.id;
        (session.user as any).role = token.role;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",
  },
};

// Augment NextAuth types
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
    };
  }
  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
  }
}
