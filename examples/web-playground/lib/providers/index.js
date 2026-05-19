// Browser-direct TTS provider registry (Mode B).
//
// Each adapter exposes:
//   id           — short identifier matching the gateway's provider names
//   label        — UI string
//   defaults     — { voice, model } used when the user leaves fields blank
//   keyPlaceholder, voiceLabel — UI hints
//   synthesizeToPcm(text, { apiKey, voice?, model? }) → Promise<Uint8Array>
//     returns 16 kHz mono 16-bit LE PCM ready for POST /api/v1/tts/{lid}.

import { elevenLabsTts } from "./elevenlabs-tts.js";
import { geminiTts } from "./gemini-tts.js";

export const browserTtsAdapters = {
  [elevenLabsTts.id]: elevenLabsTts,
  [geminiTts.id]: geminiTts,
};

export function getBrowserTtsAdapter(id) {
  return browserTtsAdapters[id] || null;
}

export function listBrowserTtsProviders() {
  return Object.values(browserTtsAdapters);
}
