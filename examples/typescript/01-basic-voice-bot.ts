/**
 * Example 1: Basic AI Voice Bot (Korean)
 *
 * Answers incoming calls with a Claude-powered AI assistant.
 * STT: Deepgram Nova-3 (Korean)
 * LLM: Claude Sonnet 4.6 (streaming)
 * TTS: ElevenLabs Flash v2.5 (Korean voice)
 *
 * Target E2E latency: < 500ms
 *
 * DVGateway ports:
 *   :8080 — API server (this SDK connects here)
 *   :8092 — Media server (Dynamic VoIP connects here, GW_MEDIA_ADDR)
 *   :8088 — Dynamic VoIP ARI (DVGateway connects to Dynamic VoIP here)
 *
 * Run:
 *   cp .env.example .env  # fill in your API keys
 *   npx ts-node examples/01-basic-voice-bot.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';

// ─── 1. 클라이언트 초기화 ───────────────────────────────────────────────────

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: {
    type: 'apiKey',
    apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth',
  },
  reconnect: {
    maxAttempts: 10,
    initialDelayMs: 2000,
    onReconnect: (attempt) => console.log(`[reconnect] 재연결 시도 #${attempt}`),
  },
});

// ─── 2. AI 어댑터 설정 ────────────────────────────────────────────────────

const stt = new DeepgramAdapter({
  apiKey:         process.env['DEEPGRAM_API_KEY']!,
  language:       'ko',               // 한국어
  model:          'nova-3',           // 2026 최신 모델
  interimResults: true,               // 실시간 부분 전사
  endpointingMs:  400,                // 발화 끝 감지 (400ms 침묵)
  smartFormat:    true,               // 자동 구두점/숫자 포맷팅
});

const llm = new AnthropicAdapter({
  apiKey:       process.env['ANTHROPIC_API_KEY']!,
  model:        'claude-sonnet-4-6',  // 음성 봇 최적 균형
  systemPrompt:
    '당신은 OLSSOO Inc.의 친절한 AI 고객 상담원입니다. ' +
    '답변은 TTS에 적합하게 짧고 자연스러운 구어체로 해주세요. ' +
    '한 번에 1-2문장 이내로 답하세요.',
  maxTokens:    256,                  // 짧은 음성 응답에 최적화
  temperature:  0.7,
});

const tts = new ElevenLabsAdapter({
  apiKey:  process.env['ELEVENLABS_API_KEY']!,
  voiceId: process.env['ELEVENLABS_VOICE_ID'] ?? '21m00Tcm4TlvDq8ikWAM',
  model:   'eleven_flash_v2_5',       // 최저 지연 (~75ms)
});

// ─── 3. 파이프라인 시작 ──────────────────────────────────────────────────

console.log('🎙️  DVGateway AI 음성 봇 시작...');
console.log('📡  게이트웨이:', process.env['DV_BASE_URL']);
console.log('🔊  콜을 기다리는 중...\n');

await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)
  .onNewCall((session) => {
    console.log(
      `📞 새 콜 수신\n` +
      `   linkedId  : ${session.linkedId}\n` +
      `   발신자번호 : ${session.caller ?? '알 수 없음'}\n` +
      `   발신자이름 : ${session.callerName ?? '알 수 없음'}\n` +
      `   DID 번호   : ${session.did ?? '알 수 없음'}`
      // ── session에서 추가로 출력할 수 있는 필드 ──
      // + `\n   착신번호   : ${session.callee}`       // 착신번호 (B-leg / EXTEN)
      // + `\n   콜 ID     : ${session.callId}`        // 업무 시스템 통화 ID (CRM 등)
      // + `\n   상담원내선 : ${session.agentNumber}`   // 상담원 내선번호
      // + `\n   방향       : ${session.dir}`           // 스트림 방향 (both/in/out)
      // + `\n   컨퍼런스ID : ${session.confId}`        // ConfBridge 컨퍼런스 ID
      // + `\n   테넌트 ID  : ${session.tenantId}`      // 멀티테넌트 식별자
      // + `\n   시작시각   : ${session.startedAt}`     // 통화 시작 시각 (Date)
      // + `\n   스트림 URL : ${session.streamUrl}`     // 오디오 WebSocket URL
      // + `\n   메타데이터 : ${JSON.stringify(session.metadata)}`  // 커스텀 키-값
    );
  })
  .onCallEnded((linkedId, duration) => {
    console.log(`📴 [${linkedId}] 통화 종료 (${duration}초)`);
    // 주기적으로 메트릭 출력
    gw.metrics.logSummary();
  })
  .onTranscript((result, session) => {
    if (result.isFinal) {
      console.log(`💬 [${session.linkedId}] 사용자: "${result.text}" (신뢰도: ${((result.confidence ?? 0) * 100).toFixed(0)}%)`);
    }
  })
  .onError((err, linkedId) => {
    console.error(`❌ [${linkedId ?? 'global'}] 오류:`, err.message);
  })
  .start();
