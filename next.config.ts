import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3"],
  async redirects() {
    return [
      // /mir was the first Ministry Impact Reports: an empty form-and-PDF
      // version whose tables 0096 drops. The reports are the mir-* builder
      // pages, listed together in their own hub layer, so every old /mir URL
      // (the list, /mir/new, /mir/<id>) opens that layer.
      {
        source: "/mir/:path*",
        destination: "/more?layer=ministry-impact-reports",
        permanent: true,
      },
    ];
  },
  experimental: {
    serverActions: {
      // Default is 1 MB. Raised for the MIR PDF upload (gone with /mir) and
      // kept for the two uploads left: the attendance .xlsx importer takes a
      // quarter's files at once, and the PushPay CSV import a whole export.
      // 20 MB leaves room without inviting truly huge uploads.
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
