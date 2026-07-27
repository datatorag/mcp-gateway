#!/usr/bin/env node
// ElevenLabs TTS generator for the DataToRAG MCP Voyager-style explainer.
// Node 20+, zero deps. Uses global fetch and fs/promises.
//
// BUDGET WARNINGS (calculated at 130 wpm for Sagan-pace narration with
// deliberate sentence-stop pauses):
//   Ch01 — 13 words → ~6.0s  (budget 6s)  AT
//   Ch02 — 29 words → ~13.4s (budget 14s) OK
//   Ch03 — 21 words → ~9.7s  (budget 10s) OK
//   Ch04 — 22 words → ~10.2s (budget 11s) OK
//   Ch05 — 20 words → ~9.2s  (budget 9s)  TIGHT, acceptable
//   Ch06 — 14 words → ~6.5s  (budget 10s) OK, ~3s held silence to tail

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

const OUT_DIR = "./out";
// v3 is the expressive model; Turbo v2.5 flattens prosody (measured) and
// kills the contemplative Voyager narration register.
const MODEL_ID = "eleven_v3";
const VOICE_SETTINGS = {
  stability: 0.45,
  similarity_boost: 0.75,
  style: 0.25,
  use_speaker_boost: true,
};

const CHAPTERS = [
  {
    chapter: 1,
    name: "BLIND",
    startSec: 0,
    endSec: 7,
    text: "An AI agent. Smart in conversation. Blind to the work you actually do.",
  },
  {
    chapter: 2,
    name: "THE TANGLE",
    startSec: 7,
    endSec: 22,
    text: "Gmail. Calendar. Drive. Docs. Jira. Sheets. Where work happens. Each one needs its own connector. Its own sign-in. And only one account at a time.",
  },
  {
    chapter: 3,
    name: "ONE STATION",
    startSec: 22,
    endSec: 33,
    text: "DataToRAG is one endpoint. One sign-in. Every tool. Every account. Work, personal, or other. All through the same station.",
  },
  {
    chapter: 4,
    name: "THE CATALOG",
    startSec: 33,
    endSec: 45,
    text: "Seventy tools, and growing. Google Workspace. Atlassian. More on the way. Multi-account built in, for work and personal in one prompt.",
  },
  {
    chapter: 5,
    name: "ONE LINE",
    startSec: 45,
    endSec: 55,
    text: "One line in the config. One sign-in. And the agent has what it needs. No OAuth shuffle. No token bloat.",
  },
  {
    chapter: 6,
    name: "CONNECTED",
    startSec: 55,
    endSec: 68,
    text: "Now the agent sees. Open source. Hosted, or run it yourself. DataToRAG dot com.",
  },
];

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

function countWords(text) {
  return text.trim().split(/\s+/).length;
}

function estimateSeconds(wordCount) {
  return +(wordCount / 155 * 60).toFixed(2);
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
    body: JSON.stringify({
      text,
      model_id: MODEL_ID,
      voice_settings: VOICE_SETTINGS,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`ElevenLabs ${res.status}: ${body.slice(0, 300)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const apiKey = requireEnv("ELEVENLABS_API_KEY");
  const voiceId = requireEnv("ELEVENLABS_VOICE_ID");
  await mkdir(OUT_DIR, { recursive: true });

  const manifest = [];
  for (const ch of CHAPTERS) {
    const file = `ch${String(ch.chapter).padStart(2, "0")}.mp3`;
    const wordCount = countWords(ch.text);
    const estimatedSeconds = estimateSeconds(wordCount);
    process.stdout.write(`ch${ch.chapter} ${ch.name} (${wordCount}w, ~${estimatedSeconds}s) ... `);
    const audio = await synthesize(voiceId, apiKey, ch.text);
    await writeFile(join(OUT_DIR, file), audio);
    manifest.push({
      chapter: ch.chapter,
      name: ch.name,
      startSec: ch.startSec,
      endSec: ch.endSec,
      wordCount,
      estimatedSeconds,
      file,
    });
    console.log(`${audio.length.toLocaleString()} bytes`);
  }
  await writeFile(
    join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n"
  );
  console.log(`\nDone. ${manifest.length} chapters written to ${OUT_DIR}/`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
