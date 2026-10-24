/**
 * SCRUM-437: an upload that fails somewhere of ours gives its link back.
 * The naming step is made to throw once, standing in for anything unforeseen
 * after the link is claimed.
 */

import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const fail = vi.hoisted(() => ({ once: true }));
vi.mock("./file-inbound", async (importOriginal) => {
  const real = await importOriginal<typeof import("./file-inbound")>();
  return {
    ...real,
    cleanInboundName: (...args: Parameters<typeof real.cleanInboundName>) => {
      if (fail.once) {
        fail.once = false;
        throw new Error("unforeseen");
      }
      return real.cleanInboundName(...args);
    },
  };
});

import { createFileDownloadRouter } from "./file-download-route";
import { createUploadLink, inspectUploadLink, resetDownloadLinks, UPLOAD_PATH } from "./file-download";
import { uploadsInFlight } from "./file-crossing";

let server: Server;
afterEach(async () => {
  await new Promise((r) => server?.close(r));
});

it("gives the link back and answers 500 when something of ours throws, and the link then works", async () => {
  resetDownloadLinks();
  const app = express();
  app.use(createFileDownloadRouter({ db: {} as Database, baseUrl: "https://gw.example.test" }));
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const made = createUploadLink({ userId: "user-1", args: {}, baseUrl: "https://gw.example.test" });
  const path = String(JSON.parse(made.content[0].text as string).link.url).replace("https://gw.example.test", "");
  const body = new Uint8Array(8).fill(1);

  const failed = await fetch(`${origin}${path}`, { method: "PUT", body });
  expect(failed.status).toBe(500);
  expect(inspectUploadLink(path.split(UPLOAD_PATH)[1]).kind).toBe("live");
  expect(uploadsInFlight()).toBe(0);

  const again = await fetch(`${origin}${path}`, { method: "PUT", body });
  expect(again.status).toBe(200);
});
