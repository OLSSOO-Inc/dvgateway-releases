// Provider registry — single source of truth for TTS/STT provider options
// shown in the playground sidebar.
//
// Why SSOT here:
//   index.html previously hardcoded <option> entries while this file knew
//   the browser-direct (Mode B) adapter list separately → UI showed
//   providers that weren't supported and confused users (e.g. Gemini in
//   the Mode A pick list but the user expected Mode B). app.js now
//   reads PROVIDER_REGISTRY and renders <select> options dynamically so
//   "지원 가능한 provider"가 한 곳에서만 정의됩니다.
//
// Each entry shape:
//   id            — string sent to the gateway as the `provider` field
//   label         — UI display string
//   modeASupported — gateway-side synthesis/STT (POST /api/v1/config/apikeys)
//   modeBAdapter  — TTS only: browser-direct adapter (null for STT)
//
// To add a new TTS provider that the gateway supports but the browser
// cannot call directly, set modeBAdapter to null and modeASupported true.
// The Mode B radio will hide it automatically in the TTS list.

import { elevenLabsTts } from "./elevenlabs-tts.js";
import { geminiTts } from "./gemini-tts.js";

export const TTS_PROVIDERS = [
  {
    id: elevenLabsTts.id,
    label: "ElevenLabs",
    modeASupported: true,
    modeBAdapter: elevenLabsTts,
  },
  {
    id: geminiTts.id,
    label: "Google Gemini",
    modeASupported: true,
    modeBAdapter: geminiTts,
  },
];

export const STT_PROVIDERS = [
  // Mode B는 STT 지원 안 함 (브라우저가 RTP를 직접 들을 수 없음).
  // 게이트웨이가 실제 라우팅 가능한 provider만 등록.
  { id: "deepgram", label: "Deepgram",                   modeASupported: true, modeBAdapter: null },
  { id: "openai",   label: "OpenAI (Realtime / Whisper)", modeASupported: true, modeBAdapter: null },
  { id: "google",   label: "Google Cloud STT",            modeASupported: true, modeBAdapter: null },
];

// browserTtsAdapters: 1.4.5.x 이하 호환용 lookup. 새 코드는 PROVIDER_REGISTRY
// 또는 getBrowserTtsAdapter()를 사용.
export const browserTtsAdapters = TTS_PROVIDERS.reduce((acc, p) => {
  if (p.modeBAdapter) acc[p.id] = p.modeBAdapter;
  return acc;
}, {});

export function getBrowserTtsAdapter(id) {
  return browserTtsAdapters[id] || null;
}

export function listBrowserTtsProviders() {
  return Object.values(browserTtsAdapters);
}

// TTS / STT provider 메타데이터를 UI에 한 번에 전달. mode가 "B"면
// modeBAdapter가 있는 항목만 반환 (= 브라우저에서 직접 호출 가능한 것).
export function listTtsProviders(mode) {
  return mode === "B" ? TTS_PROVIDERS.filter((p) => p.modeBAdapter) : TTS_PROVIDERS;
}

export function listSttProviders() {
  // STT는 Mode A 전용이라 mode 인자 받지 않음. modeASupported가 false인
  // 항목이 미래에 추가되면 그때 필터링.
  return STT_PROVIDERS.filter((p) => p.modeASupported);
}
