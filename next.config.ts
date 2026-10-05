import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" is only needed for self-hosting (Caddy/bun). Vercel builds
  // its own output, so only enable it when explicitly requested:
  //   STANDALONE=1 npm run build:standalone
  ...(process.env.STANDALONE === "1" ? { output: "standalone" as const } : {}),

  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,

  // src/app/page.tsx reads src/lib/landing-body.html with fs at runtime.
  // Serverless functions only ship files they can statically trace, so
  // force-include it for the "/" route.
  outputFileTracingIncludes: {
    "/": ["./src/lib/landing-body.html"],
  },
};

export default nextConfig;
