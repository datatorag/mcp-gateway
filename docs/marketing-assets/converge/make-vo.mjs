#!/usr/bin/env node
// Convergence clip — generate the ElevenLabs voiceover and mux it onto
// datatorag-converge.webm, producing one finished H.264 MP4 for Google Ads.
//
// Run from anywhere (paths resolve relative to this file):
//   read -rs ELEVENLABS_API_KEY && export ELEVENLABS_API_KEY \
//     && node docs/marketing-assets/converge/make-vo.mjs
//
// Optional: ELEVENLABS_VOICE_ID (defaults to Josh — same voice as the landing-page explainer).
// To use a different read, swap NARRATION below for one in elevenlabs-script.md.
//
// Outputs (into this folder):
//   datatorag-converge-vo.mp3          the voiceover
//   datatorag-converge-vo.mp4          muxed, H.264 + AAC, ready to upload

import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const DIR = import.meta.dirname;
const SRC_VIDEO = join(DIR, "datatorag-converge.webm");
const MODEL_ID = "eleven_turbo_v2_5";
const VOICE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.75,
  style: 0.25,
  use_speaker_boost: true,
};

// The voiceover for the convergence visual ("The Convergence" read).
// Alternate reads are in elevenlabs-script.md if you want to swap.
// "Data to RAG" (with spaces) so ElevenLabs says "data-to-rag", not the camel-case string.
const NARRATION =
  "Every tool your agent needs is one more integration to build and maintain. Data to RAG brings them all together through a single gateway — pre-built, or custom.";

function requireEnv(name, fallback) {
  const v = process.env[name] || fallback;
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

async function synthesize(voiceId, apiKey, text) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: "audio/mpeg",
    },
    body: JSON.stringify({ text, model_id: MODEL_ID, voice_settings: VOICE_SETTINGS }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))
    );
  });
}

function ffprobeDuration(file) {
  return new Promise((resolve) => {
    const p = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", file,
    ]);
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => resolve(parseFloat(out.trim())));
  });
}

async function main() {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const voiceId = requireEnv("ELEVENLABS_VOICE_ID", "ZoiZ8fuDWInAcwPXaVeq"); // Josh — landing-page voice
  const videoDur = await ffprobeDuration(SRC_VIDEO);
  console.log(`source video: ${videoDur.toFixed(2)}s\n`);

  const mp3 = join(DIR, "datatorag-converge-vo.mp3");
  const mp4 = join(DIR, "datatorag-converge-vo.mp4");
  process.stdout.write("synth voiceover ... ");
  const audio = await synthesize(voiceId, apiKey, NARRATION);
  await writeFile(mp3, audio);
  const voDur = await ffprobeDuration(mp3);

  // Output length = max(video, VO), so we never cut the visual short and never cut
  // the narration off. tpad clones the last frame to cover a VO that runs past the
  // video; -t fixes the exact end. Transcode VP9 -> H.264 for ad upload.
  const target = Math.max(videoDur, voDur).toFixed(3);
  await run("ffmpeg", [
    "-y", "-i", SRC_VIDEO, "-i", mp3,
    "-map", "0:v:0", "-map", "1:a:0",
    "-vf", "tpad=stop_mode=clone:stop_duration=2",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "high", "-crf", "18",
    "-r", "30", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "-t", target, mp4,
  ]);

  console.log(`video ${videoDur.toFixed(2)}s, VO ${voDur.toFixed(2)}s -> ${mp4.split("/").pop()} (${target}s)`);
  console.log("\nDone. Play datatorag-converge-vo.mp4 — that's the file to upload.");
}

main().catch((err) => {
  console.error("\n" + err.message);
  process.exit(1);
});
