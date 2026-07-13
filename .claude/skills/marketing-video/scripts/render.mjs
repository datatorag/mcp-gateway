// Frame-by-frame capture of the Voyager explainer.
// Strategy: pause the animation, then drive `t` via the range-slider scrubber,
// screenshot each frame, assemble with ffmpeg. Deterministic, slow but reliable.

import { mkdir, rm, readFile, stat } from "node:fs/promises";
import { join, resolve, extname } from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import puppeteer from "puppeteer";

const MIME = {
  ".html": "text/html",
  ".jsx":  "text/javascript",   // babel-standalone reads via fetch; needs a JS mime
  ".js":   "text/javascript",
  ".mjs":  "text/javascript",
  ".css":  "text/css",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".json": "application/json",
};

async function startStaticServer(rootDir) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let p = decodeURIComponent(url.pathname);
      if (p === "/") p = "/index.html";
      const fp = join(rootDir, p);
      const st = await stat(fp);
      if (!st.isFile()) { res.writeHead(404); res.end(); return; }
      const buf = await readFile(fp);
      res.writeHead(200, { "content-type": MIME[extname(fp)] || "application/octet-stream" });
      res.end(buf);
    } catch {
      res.writeHead(404); res.end();
    }
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  return { server, port };
}

const BUILD_DIR  = resolve(process.argv[2]);
const OUT_DIR    = resolve(process.argv[3]);
const FRAMES_DIR = join(OUT_DIR, "frames");
const VIDEO_OUT  = join(OUT_DIR, "video.mp4");
const FPS = 30;
const DURATION_S = 68;
const TOTAL_FRAMES = FPS * DURATION_S;

async function main() {
  await rm(FRAMES_DIR, { recursive: true, force: true });
  await mkdir(FRAMES_DIR, { recursive: true });
  const { server, port } = await startStaticServer(BUILD_DIR);
  const url = `http://127.0.0.1:${port}/index.html`;
  console.log(`Serving ${BUILD_DIR} on ${url}`);
  console.log(`Frames: ${FRAMES_DIR}`);
  console.log(`Capturing ${TOTAL_FRAMES} frames @ ${FPS}fps`);

  const browser = await puppeteer.launch({
    headless: "shell",
    args: [
      "--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage",
      "--font-render-hinting=none",
      "--allow-file-access-from-files",  // let babel fetch .jsx from file://
      "--disable-web-security",
    ],
    defaultViewport: { width: 1080, height: 1920, deviceScaleFactor: 1 },
  });
  console.log("Browser launched");

  const page = await browser.newPage();
  page.on("console", (msg) => console.log(`[browser ${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => console.log(`[browser error] ${err.message}`));
  await page.goto(url, { waitUntil: "networkidle0", timeout: 60000 });
  console.log("Page loaded");
  await page.evaluate(() => document.fonts.ready);

  // Wait for React to mount the scrubber (input is part of <Scrubber />)
  await page.waitForSelector('input[type="range"]', { timeout: 30000 });
  console.log("Scrubber mounted");

  // Hide the dev scrubber visually (still queryable in DOM, just invisible)
  await page.addStyleTag({ content: `
    input[type="range"] { opacity: 0 !important; pointer-events: none !important; }
    button { display: none !important; }
    /* The whole scrubber container — hide its gradient bg + text */
    body > #root > div > div:last-child { opacity: 0 !important; pointer-events: none !important; }
  `});

  // Pause playback
  await page.keyboard.press("Space");
  await page.evaluate(() => new Promise(r => requestAnimationFrame(r)));
  console.log("Paused. Scrubbing frames...");

  const start = Date.now();
  for (let i = 0; i < TOTAL_FRAMES; i++) {
    const t = i / FPS;
    await page.evaluate((tVal) => {
      const input = document.querySelector('input[type="range"]');
      if (!input) throw new Error("No range input found");
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, String(tVal));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, t);
    // Let React commit
    await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

    const fname = `f_${String(i).padStart(5, "0")}.png`;
    await page.screenshot({ path: join(FRAMES_DIR, fname), type: "png" });

    if (i % 60 === 0) {
      const el = ((Date.now() - start) / 1000).toFixed(1);
      const pct = ((i / TOTAL_FRAMES) * 100).toFixed(1);
      process.stdout.write(`  ${pct}% (${i}/${TOTAL_FRAMES}) [${el}s elapsed]\n`);
    }
  }
  console.log("All frames captured.");
  await browser.close();
  server.close();

  console.log("Encoding MP4 with ffmpeg...");
  await new Promise((res, rej) => {
    const ff = spawn("ffmpeg", [
      "-y",
      "-framerate", String(FPS),
      "-i", join(FRAMES_DIR, "f_%05d.png"),
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-crf", "18",
      "-preset", "medium",
      "-movflags", "+faststart",
      VIDEO_OUT,
    ], { stdio: "inherit" });
    ff.on("close", c => c === 0 ? res() : rej(new Error(`ffmpeg ${c}`)));
  });
  console.log(`\nDone: ${VIDEO_OUT}`);
}

main().catch(e => { console.error(e); process.exit(1); });
