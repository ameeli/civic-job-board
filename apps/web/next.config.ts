import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not build output.
  transpilePackages: ["@civic-job-board/core", "@civic-job-board/db"],
};

export default nextConfig;
