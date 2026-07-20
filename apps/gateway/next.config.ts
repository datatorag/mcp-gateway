import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The gateway package writes relative imports in NodeNext/ESM style
  // (explicit ".js" specifiers pointing at ".ts" source, e.g. track.ts's
  // `from "../lib/slack.js"`) — that's what tsc's "bundler" moduleResolution
  // and tsup's build of server.ts both already resolve correctly. Next's
  // webpack build doesn't do that resolution by default, so any app route
  // that (transitively) imports a gateway/*.ts module needs this alias, or
  // webpack 404s on the literal ".js" file. Playground routes are the first
  // routes to pull gateway/track.ts and gateway/playground/tools.ts into the
  // Next bundle.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".ts", ".tsx", ".js"],
    };
    return config;
  },
};

export default nextConfig;
