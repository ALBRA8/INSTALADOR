import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Raíz del workspace Turbopack FIJADA al proyecto: determinista aunque
  // este repo se clone anidado dentro de otro (CI del MSI, fixtures).
  turbopack: {
    root: __dirname,
  },
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
