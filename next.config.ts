import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse / pdfjs-dist do their own dynamic loading (workers etc.)
  // that Next's bundler chokes on — keep them external and resolved at
  // runtime by Node, same as better-sqlite3.
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "pdfjs-dist"],
  experimental: {
    serverActions: {
      // Default is 1 MB, which silently 502s MIR PDF uploads (the real
      // ones can be 5-10 MB). Cap at 20 MB to leave room without
      // inviting truly huge uploads.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
