// LearnLens main page — server component.
// • Not signed in → render the rich landing page (HTML body loaded from disk
//   and passed to the LandingPage client component, which hydrates + wires
//   up theme toggle / mobile menu / auth modal).
// • Signed in → render AppShell with role-based dashboard.
//
// Single-route rule from the fullstack-dev skill: only `/` is user-visible.
// Auth + dashboard switching all happen in this one page.

import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { LandingPage } from "@/components/landing-page";
import { promises as fs } from "node:fs";
import path from "node:path";

async function readLandingBody(): Promise<string> {
  try {
    const file = path.join(process.cwd(), "src/lib/landing-body.html");
    return await fs.readFile(file, "utf8");
  } catch (err) {
    console.error("[page] failed to read landing-body.html:", err);
    // Fallback minimal landing so the page never 500s
    return `
      <main class="min-h-screen grid place-items-center bg-gradient-to-br from-brand-50 to-white p-8">
        <div class="text-center max-w-md">
          <h1 class="font-display font-extrabold text-4xl text-brand-700">LearnLens</h1>
          <p class="mt-2 text-ink-600">Multimodal Student Assignment Analysis &amp; Learning Analytics.</p>
          <p class="mt-4 text-xs text-ink-400">Couldn't load landing-body.html — check the file path.</p>
        </div>
      </main>`;
  }
}

export default async function Home() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    const htmlBody = await readLandingBody();
    return <LandingPage htmlBody={htmlBody} />;
  }
  return <AppShell user={session.user as any} />;
}
