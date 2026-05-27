import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdf-parse / pdfjs-dist do their own dynamic loading (workers etc.)
  // that Next's bundler chokes on — keep them external and resolved at
  // runtime by Node, same as better-sqlite3.
  serverExternalPackages: [
    "better-sqlite3",
    "pdf-parse",
    "pdfjs-dist",
    "tesseract.js",
    "@napi-rs/canvas",
  ],
  // pdfjs loads its "fake worker" via a dynamic import to a sibling
  // file Next's tracer can't see — without this the standalone build
  // ships pdf.mjs but NOT pdf.worker.mjs, and uploads die with
  // "Setting up fake worker failed". Pin the worker files into the
  // standalone output for any /mir route.
  outputFileTracingIncludes: {
    "/mir": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      // tesseract.js worker + WASM core + native canvas binding — none
      // of these are reachable by Next's static tracer.
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@napi-rs/canvas/**/*",
    ],
    "/mir/**": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      "./node_modules/tesseract.js/**/*",
      "./node_modules/tesseract.js-core/**/*",
      "./node_modules/@napi-rs/canvas/**/*",
    ],
  },
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
