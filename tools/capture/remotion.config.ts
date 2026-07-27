import path from "node:path";
import { Config } from "@remotion/cli/config";
import { enableTailwind } from "@remotion/tailwind-v4";

// __dirname is unreliable here (the config executes from inside the CLI
// bundle), so resolve against the project dir the CLI runs from.
const PROJECT_DIR = process.cwd();
const GATEWAY = path.resolve(PROJECT_DIR, "../../apps/gateway");

// Serve the gateway's real public assets (logos, /icons/services/*) so
// components that reference them render truthfully. Note Remotion does NOT
// serve this at the URL root — author shots with staticFile("icons/...").
Config.setPublicDir(path.join(GATEWAY, "public"));

Config.overrideWebpackConfig((config) => {
  const withTailwind = enableTailwind(config);
  return {
    ...withTailwind,
    resolve: {
      ...withTailwind.resolve,
      alias: {
        ...(withTailwind.resolve?.alias ?? {}),
        // The entire point of this project: "@/components/..." resolves to the
        // REAL gateway source. A screenshot cannot silently misrepresent the
        // product, because it renders the product.
        "@": path.join(GATEWAY, "src"),
        // Pin react to THIS project's copy. Gateway components would otherwise
        // resolve the gateway's react — two React instances break hooks.
        react: path.dirname(require.resolve("react/package.json")),
        "react-dom": path.dirname(require.resolve("react-dom/package.json")),
      },
    },
  };
});
