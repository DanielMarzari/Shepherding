import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse / pdfjs-dist do their own dynamic loading (workers etc.)
  // that Next's bundler chokes on — keep them external and resolved at
  // runtime by Node, same as better-sqlite3.
  serverExternalPackages: ["better-sqlite3", "pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
