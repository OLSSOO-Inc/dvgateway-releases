/**
 * Example 5: Cached TTS for Announcements
 *
 * Demonstrates how to use CachedTtsAdapter to reduce TTS API costs by
 * caching synthesized audio on disk. Cached audio persists across
 * process restarts — no redundant API calls for repeated announcements.
 *
 * Use cases:
 *   - IVR 안내 멘트 (잠시만 기다려 주세요, 상담사 연결 중...)
 *   - Conference broadcast announcements
 *   - Scheduled announcement broadcasts
 *
 * Run:
 *   cp .env.example .env  # fill in your API keys
 *   npx ts-node examples/05-cached-tts-announcements.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter, GeminiTtsAdapter, CachedTtsAdapter } from 'dvgateway-adapters';

// ─── 1. 클라이언트 초기화 ───────────────────────────────────────────────────

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: {
    type: 'apiKey',
    apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth',
  },
});

// ─── 2. AI 어댑터 설정 (TTS 캐시 포함) ──────────────────────────────────────

const stt = new DeepgramAdapter({
  apiKey:   process.env['DEEPGRAM_API_KEY']!,
  language: 'ko',
  model:    'nova-3',
});

const llm = new OpenAILlmAdapter({
  apiKey:       process.env['OPENAI_API_KEY']!,
  model:        'gpt-4o-mini',
  systemPrompt: '당신은 친절한 AI 상담원입니다. 짧고 자연스럽게 답하세요.',
  maxTokens:    256,
});

// 기본 TTS 어댑터
const ttsProvider = process.env['TTS_PROVIDER'] ?? 'gemini';

const baseTts = ttsProvider === 'elevenlabs'
  ? new ElevenLabsAdapter({
      apiKey:  process.env['ELEVENLABS_API_KEY']!,
      voiceId: process.env['ELEVENLABS_VOICE_ID'] ?? '21m00Tcm4TlvDq8ikWAM',
      model:   'eleven_flash_v2_5',
    })
  : new GeminiTtsAdapter({
      apiKey: process.env['GEMINI_API_KEY']!,
    });

// CachedTtsAdapter로 감싸기 — 디스크 캐시 활성화
const tts = new CachedTtsAdapter(baseTts, {
  provider:       ttsProvider,
  cacheDir:       './tts-cache',         // 캐시 디렉토리 (재시작 후에도 유지)
  defaultVoiceId: ttsProvider === 'elevenlabs'
    ? (process.env['ELEVENLABS_VOICE_ID'] ?? '21m00Tcm4TlvDq8ikWAM')
    : 'Kore',
  defaultModel:   ttsProvider === 'elevenlabs' ? 'eleven_flash_v2_5' : 'gemini-2.5-flash-tts',
  ttlMs:          7 * 24 * 60 * 60 * 1000, // 7일 TTL
  maxEntries:     500,                     // 최대 500개 캐시 항목
});

// ─── 3. 안내 멘트 사전 생성 (warmup) ────────────────────────────────────────

// 서버 시작 시 자주 사용하는 안내 멘트를 미리 생성
// 이미 캐시에 있으면 API 호출 없이 건너뜀
const ANNOUNCEMENTS = [
  { text: '안녕하세요. OLSSOO 고객센터에 전화해 주셔서 감사합니다.' },
  { text: '잠시만 기다려 주세요. 상담사에게 연결하겠습니다.' },
  { text: '현재 상담 대기 중입니다. 잠시만 기다려 주세요.' },
  { text: '통화가 종료되었습니다. 이용해 주셔서 감사합니다.' },
  { text: '업무 시간이 종료되었습니다. 영업 시간은 평일 오전 9시부터 오후 6시까지입니다.' },
  { text: '본 통화는 서비스 품질 향상을 위해 녹음됩니다.' },
  { text: '상담사가 모두 통화 중입니다. 잠시 후 다시 시도해 주세요.' },
];

console.log('🔊 TTS 안내 멘트 캐시 워밍업 시작...');
const newlySynthesized = await tts.warmup(ANNOUNCEMENTS);
console.log(`✅ 워밍업 완료: ${newlySynthesized}개 새로 생성, ${ANNOUNCEMENTS.length - newlySynthesized}개 캐시 히트`);

// ─── 4. 파이프라인 시작 ──────────────────────────────────────────────────

console.log('\n🎙️  DVGateway AI 음성 봇 시작 (캐시 TTS 활성화)');
console.log('📡  게이트웨이:', process.env['DV_BASE_URL']);

await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)   // CachedTtsAdapter — 동일 텍스트는 캐시에서 즉시 반환
  .onNewCall(async (session) => {
    console.log(
      `📞 [${session.linkedId}] 새 콜 수신\n` +
      // ── 커스텀 값 (Dynamic VoIP 다이얼플랜에서 전달) ──
      // Dialplan: Set(__CUSTOM_VALUE_01=${customer_name})
      // 용도 예시: 고객명, 주문번호, 통화 목적 등 CRM 연동 데이터
      `   커스텀값1   : ${session.customValue1 ?? '없음'}\n` +
      `   커스텀값2   : ${session.customValue2 ?? '없음'}\n` +
      `   커스텀값3   : ${session.customValue3 ?? '없음'}`
    );

    // 캐시된 안내 멘트를 즉시 재생 (API 호출 없음!)
    await gw.injectTts(
      session.linkedId,
      tts.synthesize('안녕하세요. OLSSOO 고객센터에 전화해 주셔서 감사합니다.'),
    );
  })
  .onCallEnded((linkedId, duration) => {
    console.log(`📴 [${linkedId}] 통화 종료 (${duration}초)`);

    // 캐시 통계 출력
    const stats = tts.getStats();
    console.log(`📊 TTS 캐시: ${stats.hits} hits / ${stats.misses} misses`);
    gw.metrics.logSummary();
  })
  .onError((err, linkedId) => {
    console.error(`❌ [${linkedId ?? 'global'}] 오류:`, err.message);
  })
  .start();
