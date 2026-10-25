import { defineConfig } from "tsup";

export default defineConfig({
  // tokens: the provider-token commands (SCRUM-442), run in the container as
  // `node dist/tokens.js <command>`; the image ships dist/ and no tsx.
  entry: { server: "server.ts", tokens: "src/gateway/token-crypto-cli.ts" },
  format: ["esm"],
  clean: true,
});
