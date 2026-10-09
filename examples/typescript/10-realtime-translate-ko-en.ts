/**
 * Example 10: Real-time Korean ↔ English interpreter (gpt-realtime-translate)
 *
 * The caller speaks Korean, and the AI re-speaks it in English on the call
 * leg in real time. Swap `inputLanguage` / `outputLanguage` to invert the
 * direction or pick another supported pair (Realtime translate supports
 * 70+ input languages → 13 output languages).
 *
 * No STT / LLM / TTS adapters are wired — the translate model takes audio
 * in and emits translated audio out in a single WebSocket session.
 *
 * Run:
 *   cp .env.example .env  # set OPENAI_API_KEY + DV_BASE_URL + DV_API_KEY
 *   npx ts-node examples/typescript/10-realtime-translate-ko-en.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import { OpenAIRealtimeAdapter } from 'dvgateway-adapters/realtime';

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: {
    type: 'apiKey',
    apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth',
  },
});

// ─── Translate-mode adapter ────────────────────────────────────────────
//
// `inputLanguage` + `outputLanguage` + `gpt-realtime-translate` is enough.
// The SDK synthesizes the recommended translation system prompt
// (faithful, no commentary, preserves names/numbers, keeps pace).
// To override, pass your own `instructions: '...'` — yours always wins.

const interpreter = new OpenAIRealtimeAdapter({
  apiKey:         process.env['OPENAI_API_KEY']!,
  model:          'gpt-realtime-translate',
  voice:          'alloy',         // target-language voice
  inputLanguage:  'ko',            // caller speaks Korean
  outputLanguage: 'en',            // AI re-speaks in English
  // Server VAD with conservative silence so we don't chop mid-clause:
  turnDetection: {
    mode:              'server_vad',
    threshold:         0.5,
    prefixPaddingMs:   300,
    silenceDurationMs: 500,
  },
});

// ─── Wire transcripts to the dashboard for live debugging ──────────────

interpreter.onTranscript((t) => {
  const tag = t.role === 'assistant' ? 'EN' : 'KO';
  console.log(`[${tag}] ${t.text}`);
});

interpreter.onError((err, linkedId) => {
  console.error(`[interpreter] error linkedId=${linkedId ?? 'n/a'}:`, err.message);
});

// ─── Pipeline: hand every new call to the interpreter ──────────────────

console.log('🎙️  Korean → English live interpreter ready');
console.log('📡  Gateway:', process.env['DV_BASE_URL']);
console.log('🌐  Translate: ko → en (swap inputLanguage/outputLanguage to invert)\n');

gw.onCall(async (call) => {
  console.log(`[call ${call.linkedId}] connected — starting interpreter session`);

  const audioStream = gw.openAudioStream(call.linkedId, {
    pipelineType: 's2s',           // same wiring as S2S — translate is a flavor of S2S
    direction:    'in',            // capture caller audio only
  });

  // Route the AI's translated audio back into the call.
  interpreter.onAudioOutput((chunk) => {
    gw.injectTts(call.linkedId, chunk).catch((e) => {
      console.error(`[call ${call.linkedId}] inject failed:`, e.message);
    });
  });

  try {
    await interpreter.startSession(call.linkedId, audioStream);
  } finally {
    console.log(`[call ${call.linkedId}] interpreter session ended`);
  }
});

process.on('SIGINT', async () => {
  console.log('\nShutting down interpreter…');
  await interpreter.stop();
  process.exit(0);
});
