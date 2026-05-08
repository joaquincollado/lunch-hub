import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The proxy middleware needs trailing slashes preserved on URLs like
  // /proxy/<slug>/ so relative URLs in proxied pages resolve correctly. By
  // default Next.js 308s those to the no-slash version before middleware runs.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
