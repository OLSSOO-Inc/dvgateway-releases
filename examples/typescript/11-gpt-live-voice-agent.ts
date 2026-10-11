/**
 * Example 11: GPT-Live voice agent (OpenAI gpt-live-1, full duplex)
 *
 * The caller talks to OpenAI GPT-Live through the gateway. GPT-Live listens
 * while it speaks and hands "thinking" work to your backend (delegation).
 *
 * Before you run it:
 *   1. Dialplan: route the number to `Stasis(dvgateway, mode=customer)` —
 *      GPT-Live must hear ONLY the caller. With mode=both the stream also
 *      carries the AI's own voice and the model answers itself.
 *   2. OPENAI_API_KEY must be a paid-tier key (GPT-Live has no free tier).
 *      Cost: $0.05 per connected minute (silence included) — always stop().
 *
 * Run:
 *   cp .env.example .env  # set OPENAI_API_KEY + DV_BASE_URL + DV_API_KEY
 *   npx ts-node examples/typescript/11-gpt-live-voice-agent.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import {
  GptLiveAdapter,
  buildGptLiveInstructions,
  createSpeechSegmentInjector,
  OpenAITtsAdapter,
  CachedTtsAdapter,
} from 'dvgateway-adapters';

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth' },
});

// AI notice (Korean AI Basic Act): a fixed recorded sentence played BEFORE the
// GPT-Live session — GPT-Live paraphrases, so it cannot guarantee exact wording.
// Cached: the same sentence is synthesized once, not on every call.
const noticeTts = new CachedTtsAdapter(
  new OpenAITtsAdapter({ apiKey: process.env['OPENAI_API_KEY']!, voice: 'nova' }),
  { provider: 'openai' },
);
const NOTICE = 'AI 상담원이 응대합니다.';

const live = new GptLiveAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  delegation: { type: 'client' }, // your code answers delegations (onDelegation)
  // The delegation policy is required in practice: without it GPT-Live said
  // "yes, available" without checking in 2 of 5 measured runs (0 of 15 with it).
  instructions: buildGptLiveInstructions({
    persona: '당신은 상담 예약을 돕는 한국어 전화 상담원입니다. 차분하고 친절하게 말합니다.',
    capabilities: ['예약: 원하는 날짜·시간에 상담이 가능한지 확인하고, 예약을 만들거나 바꾸거나 취소합니다.'],
  }),
});

// Your backend. GPT-Live gives the conversation; you answer with a sentence.
// Replace this stub with your real reservation lookup.
async function checkAvailability(transcript: { speaker: string; text: string }[], pending: string): Promise<string> {
  const lastCaller = [...transcript].reverse().find((t) => t.speaker === 'customer')?.text ?? pending;
  console.log('[backend] request:', lastCaller);
  return '확인해 보니 그 시간에 상담 예약이 가능합니다. 예약을 진행할지 물어봐 주세요.';
}

// Inject GPT-Live audio one utterance at a time (not one chunk at a time —
// every injectTts call gets its own fade-in/fade-out on the gateway).
const out = createSpeechSegmentInjector((id, chunks) => gw.injectTts(id, chunks), {
  onError: (err, id) => console.error(`[call ${id}] inject failed:`, err.message),
});
live.onAudioOutput((pcm, linkedId) => out.push(linkedId, pcm));

live.onTranscript((t) => console.log(`[${t.speaker === 'agent' ? 'AI' : 'caller'}] ${t.text}`));
live.onDelegation(async ({ transcript, pending }) => ({ speak: await checkAvailability(transcript, pending) }));
live.onUnspokenResult(({ linkedId, delegationId }) => {
  // The result was sent but the model did not start speaking (measured 1 of 15).
  live.appendCommentary(linkedId, delegationId, '확인 결과를 지금 알려 주세요.');
});
live.onUsage(({ linkedId, seconds, confirmed }) => {
  if (confirmed) console.log(`[call ${linkedId}] GPT-Live billed ${seconds}s`);
});
live.onError((err, linkedId) => console.error(`[call ${linkedId ?? 'n/a'}] GPT-Live:`, err.message));

gw.onCallEvent(async (event) => {
  if (event.type === 'call:new') {
    const linkedId = event.session.linkedId;
    // 1) Fixed notice first (not billed by GPT-Live — the session is not open yet).
    await gw.say(linkedId, NOTICE, noticeTts);
    // 2) Caller voice only — dir 'in' with Stasis mode=customer.
    const audio = gw.streamAudio(linkedId, { dir: 'in', pipelineType: 's2s' });
    // Do not await: the session lasts the whole call and this handler must
    // stay free to receive call:ended.
    live.startSession(linkedId, audio).catch((e: Error) => console.error(`[call ${linkedId}]`, e.message));
  }
  if (event.type === 'call:ended') {
    out.end(event.linkedId);
    await live.stop(event.linkedId); // GPT-Live bills until the session closes
  }
});

console.log('🎙️  GPT-Live voice agent ready — gateway:', process.env['DV_BASE_URL']);

process.on('SIGINT', async () => {
  out.endAll();
  await live.stop(); // every session
  gw.close();
  process.exit(0);
});
