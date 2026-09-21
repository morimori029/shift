import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 本番配布用にサーバー一式（node_modules込み）を .next/standalone/ に自己完結させる。
  // タスクスケジューラで常駐化する際は `node server.js` を実行するだけで済むようにするため。
  output: 'standalone',
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
