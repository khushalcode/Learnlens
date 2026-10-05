"use client";
// LandingPage — renders the rich HTML from the uploaded index (1).html and
// wires up its interactivity (theme toggle, mobile menu, auth modal trigger,
// header scroll state). Used by src/app/page.tsx when the user is not signed in.
//
// The static HTML body is passed as a prop from the server component, so the
// full landing page is server-rendered (great for SEO + first-paint speed).
// We hydrate and attach event listeners in useEffect.

import { useEffect, useState, useRef } from "react";
import { useTheme } from "next-themes";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GraduationCap, Loader2, Eye, EyeOff, X } from "lucide-react";
import { toast } from "sonner";
import { signIn } from "next-auth/react";

interface LandingPageProps {
  htmlBody: string;
}

const DEMO_ACCOUNTS = [
  { role: "Admin", email: "admin@learnlens.edu", color: "from-rose-500 to-amber-500" },
  { role: "Faculty", email: "faculty@learnlens.edu", color: "from-indigo-500 to-violet-500" },
  { role: "Coordinator", email: "coordinator@learnlens.edu", color: "from-emerald-500 to-teal-500" },
  { role: "Mentor", email: "mentor@learnlens.edu", color: "from-sky-500 to-blue-500" },
  { role: "Student", email: "student01@learnlens.edu", color: "from-fuchsia-500 to-pink-500" },
];

export function LandingPage({ htmlBody }: LandingPageProps) {
  const { theme, setTheme } = useTheme();
  const [authMode, setAuthMode] = useState<"signin" | "signup" | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [email, setEmail] = useState("faculty@learnlens.edu");
  const [password, setPassword] = useState("demo1234");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // ─── Wire up DOM event listeners on the static HTML ──────────
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;

    // Theme toggle
    const themeBtn = root.querySelector("#themeToggle");
    const onTheme = () => setTheme(theme === "dark" ? "light" : "dark");
    themeBtn?.addEventListener("click", onTheme);

    // Mobile menu button
    const menuBtn = root.querySelector("#menuBtn");
    const onClose = () => setMobileMenuOpen(false);
    menuBtn?.addEventListener("click", () => setMobileMenuOpen((v) => !v));
    root.querySelectorAll(".mobile-link, a[href^='#']").forEach((a) =>
      a.addEventListener("click", onClose)
    );

    // Auth trigger buttons (data-open-auth="signin" / "signup")
    const onAuth = (e: Event) => {
      const target = e.currentTarget as HTMLElement;
      const mode = target.getAttribute("data-open-auth");
      if (mode === "signin" || mode === "signup") {
        e.preventDefault();
        setAuthMode(mode);
      }
    };
    root.querySelectorAll("[data-open-auth]").forEach((b) =>
      b.addEventListener("click", onAuth)
    );

    // Header scroll state — add backdrop after scrolling past hero
    const onScroll = () => {
      const header = root.querySelector("#siteHeader");
      const inner = root.querySelector("#headerInner");
      if (!header || !inner) return;
      const scrolled = window.scrollY > 24;
      header.classList.toggle("is-scrolled", scrolled);
      (inner as HTMLElement).style.paddingTop = scrolled ? "10px" : "";
      (inner as HTMLElement).style.paddingBottom = scrolled ? "10px" : "";
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // Hero spotlight — track mouse on hero section
    const heroSpot = root.querySelector("#heroSpotlight");
    if (heroSpot) {
      const onMove = (e: MouseEvent) => {
        const x = (e.clientX / window.innerWidth) * 100;
        const y = (e.clientY / (window.innerHeight * 0.6)) * 100;
        (heroSpot as HTMLElement).style.setProperty("--mx", `${x}%`);
        (heroSpot as HTMLElement).style.setProperty("--my", `${y}%`);
      };
      window.addEventListener("mousemove", onMove);
      return () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("scroll", onScroll);
        themeBtn?.removeEventListener("click", onTheme);
        root.querySelectorAll("[data-open-auth]").forEach((b) =>
          b.removeEventListener("click", onAuth)
        );
      };
    }

    return () => {
      window.removeEventListener("scroll", onScroll);
      themeBtn?.removeEventListener("click", onTheme);
      root.querySelectorAll("[data-open-auth]").forEach((b) =>
        b.removeEventListener("click", onAuth)
      );
    };
  }, [theme, setTheme]);

  // ─── Login submit handler ─────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
      toast.error("Login failed — check credentials");
    } else {
      toast.success("Welcome to LearnLens");
      window.location.reload();
    }
  }

  return (
    <>
      <div
        ref={containerRef}
        dangerouslySetInnerHTML={{ __html: htmlBody }}
        suppressHydrationWarning
      />

      {/* Mobile menu overlay — controlled by React, mirrors the static markup */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-[60] bg-ink-950/40 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute top-20 left-4 right-4 rounded-3xl border border-ink-200/70 dark:border-white/10 bg-white dark:bg-ink-900 backdrop-blur-xl shadow-lift p-5 space-y-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <span className="font-display font-bold text-lg">Menu</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                className="h-8 w-8 rounded-full grid place-items-center hover:bg-ink-100 dark:hover:bg-white/5"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <a href="#platform" className="block px-4 py-3 rounded-2xl hover:bg-ink-100 dark:hover:bg-white/5 font-medium" onClick={() => setMobileMenuOpen(false)}>Platform</a>
            <a href="#roles" className="block px-4 py-3 rounded-2xl hover:bg-ink-100 dark:hover:bg-white/5 font-medium" onClick={() => setMobileMenuOpen(false)}>Roles &amp; Dashboards</a>
            <a href="#analytics" className="block px-4 py-3 rounded-2xl hover:bg-ink-100 dark:hover:bg-white/5 font-medium" onClick={() => setMobileMenuOpen(false)}>Analytics</a>
            <a href="#ai" className="block px-4 py-3 rounded-2xl hover:bg-ink-100 dark:hover:bg-white/5 font-medium" onClick={() => setMobileMenuOpen(false)}>AI Engine</a>
            <a href="#security" className="block px-4 py-3 rounded-2xl hover:bg-ink-100 dark:hover:bg-white/5 font-medium" onClick={() => setMobileMenuOpen(false)}>Security &amp; RLS</a>
            <a href="#pricing" className="block px-4 py-3 rounded-2xl hover:bg-ink-100 dark:hover:bg-white/5 font-medium" onClick={() => setMobileMenuOpen(false)}>Pricing</a>
            <button
              onClick={() => { setAuthMode("signup"); setMobileMenuOpen(false); }}
              className="w-full mt-2 h-12 rounded-2xl bg-gradient-to-r from-brand-600 to-accent-600 text-white font-semibold"
            >
              Create free account
            </button>
          </div>
        </div>
      )}

      {/* Auth Modal — Sign in / Sign up */}
      <Dialog open={authMode !== null} onOpenChange={(o) => !o && setAuthMode(null)}>
        <DialogContent className="sm:max-w-md p-0 overflow-hidden gap-0">
          {/* Header band with logo + gradient */}
          <div className="relative bg-gradient-to-br from-brand-600 to-accent-600 p-6 pb-8 text-white">
            <div className="absolute inset-0 hero-grid opacity-40 pointer-events-none" />
            <div className="relative">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-white/15 backdrop-blur-md mb-3">
                <GraduationCap className="h-6 w-6" />
              </div>
              <h2 className="font-display text-2xl font-extrabold tracking-tight">
                {authMode === "signup" ? "Create your account" : "Welcome back"}
              </h2>
              <p className="text-sm text-white/80 mt-1">
                {authMode === "signup"
                  ? "Sign up to access role-based dashboards, AI analysis, and learning analytics."
                  : "Sign in to your LearnLens dashboard."}
              </p>
            </div>
          </div>

          {/* Form body */}
          <div className="p-6 space-y-4">
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <Input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@learnlens.edu"
                  required
                  autoComplete="email"
                  className="h-11"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-pw">Password</Label>
                <div className="relative">
                  <Input
                    id="auth-pw"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete={authMode === "signup" ? "new-password" : "current-password"}
                    className="h-11 pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700 dark:text-ink-400 dark:hover:text-ink-100"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-11 bg-gradient-to-r from-brand-600 to-accent-600 hover:from-brand-500 hover:to-accent-500 text-white shadow-glow"
              >
                {loading ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
                ) : authMode === "signup" ? (
                  "Create account"
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            {/* Demo logins */}
            <div className="pt-4 border-t border-ink-100 dark:border-white/10">
              <p className="text-xs font-semibold text-ink-500 dark:text-ink-400 mb-2 uppercase tracking-wide">
                Quick demo logins
              </p>
              <div className="grid grid-cols-1 gap-1.5">
                {DEMO_ACCOUNTS.map((acc) => (
                  <button
                    key={acc.email}
                    onClick={() => { setEmail(acc.email); setPassword("demo1234"); }}
                    className="text-left px-3 py-2 rounded-lg bg-ink-50 dark:bg-white/5 hover:bg-ink-100 dark:hover:bg-white/10 border border-ink-200/60 dark:border-white/10 text-xs transition-colors flex items-center gap-2"
                  >
                    <span className={`w-2 h-2 rounded-full bg-gradient-to-r ${acc.color}`} />
                    <span className="font-semibold text-ink-800 dark:text-ink-100">{acc.role}</span>
                    <span className="text-ink-500 dark:text-ink-400 truncate">{acc.email}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-ink-400 dark:text-ink-500 mt-2">
                Password for all demos: <code className="font-mono bg-ink-100 dark:bg-white/10 px-1.5 py-0.5 rounded">demo1234</code>
              </p>
            </div>

            {/* Toggle signin/signup */}
            <div className="pt-2 text-center text-sm text-ink-500 dark:text-ink-400">
              {authMode === "signup" ? "Already have an account? " : "New to LearnLens? "}
              <button
                onClick={() => setAuthMode(authMode === "signup" ? "signin" : "signup")}
                className="font-semibold text-brand-600 hover:text-brand-500 dark:text-brand-300"
              >
                {authMode === "signup" ? "Sign in instead" : "Create an account"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
