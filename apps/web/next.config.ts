import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source, not build output.
  transpilePackages: ["@civic-job-board/core", "@civic-job-board/db"],
  // Stops `next dev` from writing an untracked AGENTS.md into apps/web.
  agentRules: false,
};

export default nextConfig;
