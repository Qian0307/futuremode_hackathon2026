/** @type {import('next').NextConfig} */
const nextConfig = {};

// 讓 `next dev` 也能拿到 Cloudflare D1 binding（讀 wrangler.toml 的設定）
if (process.env.NODE_ENV === "development") {
  const { setupDevPlatform } = await import("@cloudflare/next-on-pages/next-dev");
  await setupDevPlatform();
}

export default nextConfig;
