import path from "node:path";
import { loadEnvConfig } from "@next/env";
import type { NextConfig } from "next";

// Load the monorepo root .env (Next.js only looks in apps/web by default).
loadEnvConfig(path.resolve(process.cwd(), "../.."));

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@ravi/core", "@ravi/db", "@ravi/validation", "@ravi/whatsapp"],
  serverExternalPackages: ["@prisma/client"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
