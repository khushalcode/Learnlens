"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { GraduationCap, Loader2, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

const demoAccounts = [
  { role: "Admin", email: "admin@learnlens.edu" },
  { role: "Faculty", email: "faculty@learnlens.edu" },
  { role: "Coordinator", email: "coordinator@learnlens.edu" },
  { role: "Mentor", email: "mentor@learnlens.edu" },
  { role: "Student", email: "student01@learnlens.edu" },
];

export function LoginForm() {
  const [email, setEmail] = useState("faculty@learnlens.edu");
  const [password, setPassword] = useState("demo1234");
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);

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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-indigo-50 via-violet-50 to-white px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white mb-3 shadow-lg shadow-indigo-600/30">
            <GraduationCap className="h-7 w-7" />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">LearnLens</h1>
          <p className="text-sm text-slate-600 mt-1">
            Multimodal Student Assignment Analysis &amp; Learning Analytics
          </p>
        </div>

        <Card className="border-slate-200 shadow-xl shadow-slate-200/60">
          <CardHeader>
            <CardTitle className="text-xl">Sign in</CardTitle>
            <CardDescription>
              Use one of the demo accounts below or your seeded credentials.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@learnlens.edu"
                  required
                  autoComplete="email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPw ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    aria-label={showPw ? "Hide password" : "Show password"}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full bg-indigo-600 shadow-sm shadow-indigo-600/20 hover:bg-indigo-700 transition-colors">
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Signing in…
                  </>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>

            <div className="mt-6 pt-5 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-500 mb-2.5 uppercase tracking-wide">
                Quick demo logins
              </p>
              <div className="grid grid-cols-2 gap-1.5">
                {demoAccounts.map((acc) => (
                  <button
                    key={acc.email}
                    onClick={() => {
                      setEmail(acc.email);
                      setPassword("demo1234");
                    }}
                    className="text-left px-3 py-2 rounded-md bg-slate-50 hover:bg-indigo-50 hover:border-indigo-200 border border-slate-200 text-xs transition-colors"
                  >
                    <span className="block font-semibold text-slate-700">{acc.role}</span>
                    <span className="block text-slate-500 truncate">{acc.email}</span>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-slate-400 mt-3">
                Password for all demo accounts: <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">demo1234</code>
              </p>
            </div>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-slate-400 mt-6">
          Capstone project · OOAD Lab · React + Prisma + Recharts
        </p>
      </div>
    </div>
  );
}
