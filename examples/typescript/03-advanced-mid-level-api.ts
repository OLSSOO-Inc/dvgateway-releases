/**
 * Example 3: Mid-Level API — 세밀한 제어
 *
 * 파이프라인 빌더 대신 개별 스트림 API를 직접 사용합니다.
 * 다음 시나리오에 적합:
 *   - 커스텀 VAD (음성 활동 감지) 구현
 *   - 인터럽션 감지 (사용자가 말하면 TTS 중단)
 *   - 멀티 턴 대화 히스토리 외부 관리
 *   - 상담원/고객 음성 분리 처리
 *
 * Run:
 *   npx ts-node examples/03-advanced-mid-level-api.ts
 */

import 'dotenv/config';
import { DVGatewayClient, detectVoiceActivity } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter } from 'dvgateway-adapters/tts';
import type { CallSession, Message } from 'dvgateway-sdk';

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth' },
});

// ─── 콜별 대화 상태 관리 ─────────────────────────────────────────────────

const sessions = new Map<string, {
  session: CallSession;
  history: Message[];
  isSpeaking: boolean;           // AI가 TTS 중인지 여부
}>();

// ─── 콜 이벤트 구독 ──────────────────────────────────────────────────────

gw.onCallEvent(async (event) => {
  // ── 새 콜 ──────────────────────────────────────────────────────────────
  if (event.type === 'call:new') {
    const { session } = event;
    console.log(
      `📞 [${session.linkedId}] 새 콜: ${session.caller}\n` +
      // ── 커스텀 값 (Dynamic VoIP 다이얼플랜에서 전달) ──
      // Dialplan: Set(__CUSTOM_VALUE_01=${customer_name})
      // 용도 예시: 고객명, 주문번호, 통화 목적 등 CRM 연동 데이터
      `   커스텀값1   : ${session.customValue1 ?? '없음'}\n` +
      `   커스텀값2   : ${session.customValue2 ?? '없음'}\n` +
      `   커스텀값3   : ${session.customValue3 ?? '없음'}`
    );

    sessions.set(session.linkedId, {
      session,
      history: [{ role: 'system', content: '당신은 친절한 AI 상담원입니다.' }],
      isSpeaking: false,
    });

    // 상담원 방향(out) 오디오만 구독 — 고객 목소리만 STT
    const audioStream = gw.streamAudio(session.linkedId, { dir: 'in' });

    const stt = new DeepgramAdapter({
      apiKey: process.env['DEEPGRAM_API_KEY']!,
      language: 'ko',
    });

    // 인터럽션 감지: 사용자가 말하면 TTS를 중단
    const vadStream = {
      [Symbol.asyncIterator]: async function* () {
        for await (const chunk of audioStream) {
          const state = sessions.get(session.linkedId);
          const hasVoice = detectVoiceActivity(chunk.samples, 0.015);

          if (hasVoice && state?.isSpeaking) {
            console.log(`⚡ [${session.linkedId}] 인터럽션 감지 — TTS 중단`);
            // TODO: TTS 스트림 중단 신호 전송
          }

          yield chunk;
        }
      }
    };

    stt.onTranscript(async (result) => {
      if (!result.isFinal) return;

      const state = sessions.get(session.linkedId);
      if (!state) return;

      console.log(`💬 [${session.linkedId}] "${result.text}"`);

      // 대화 히스토리에 추가
      state.history.push({ role: 'user', content: result.text });

      // LLM 호출
      const llm = new OpenAILlmAdapter({
        apiKey: process.env['OPENAI_API_KEY']!,
        model: 'gpt-4o-mini', // 최저 지연
      });

      let response = '';
      for await (const token of llm.chat(state.history)) {
        response += token;
      }

      if (!response) return;
      state.history.push({ role: 'assistant', content: response });
      console.log(`🤖 [${session.linkedId}] AI: "${response}"`);

      // TTS 합성 및 주입
      const tts = new ElevenLabsAdapter({
        apiKey: process.env['ELEVENLABS_API_KEY']!,
        model: 'eleven_flash_v2_5',
      });

      state.isSpeaking = true;
      try {
        await gw.injectTts(session.linkedId, tts.synthesize(response));
      } finally {
        state.isSpeaking = false;
      }
    });

    // STT 스트림 시작 (비동기)
    void stt.startStream(session.linkedId, vadStream as AsyncIterable<import('dvgateway-sdk').AudioChunk>);

    // 세션 메타데이터 업데이트 (CRM 연동 등)
    await gw.updateSessionMeta(session.linkedId, {
      botType: 'cs-agent',
      language: 'ko',
      startedAt: new Date().toISOString(),
    });
  }

  // ── 콜 종료 ────────────────────────────────────────────────────────────
  if (event.type === 'call:ended') {
    sessions.delete(event.linkedId);
    console.log(`📴 [${event.linkedId}] 종료 (${event.durationSec}초)`);

    // 메트릭 출력
    const stats = gw.metrics.sttLatency.percentiles();
    console.log(`📊 STT 지연: p50=${stats.p50}ms, p95=${stats.p95}ms`);
  }
});

console.log('🎙️  Mid-level API 음성 봇 시작 (상담원 방향 분리 모드)');
console.log('📡  콜을 기다리는 중...');

// 종료 시 graceful shutdown
process.on('SIGTERM', () => {
  gw.close();
  process.exit(0);
});
