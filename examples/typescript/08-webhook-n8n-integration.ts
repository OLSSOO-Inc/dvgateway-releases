/**
 * Example 8: Webhook 어댑터 — n8n / Flowise / 사내 API 연동
 *
 * LLM 호출을 외부 Webhook 엔드포인트로 위임합니다.
 * 개발자가 아닌 운영자도 n8n 같은 시나리오 편집기에서
 * AI 응답 로직을 변경할 수 있습니다.
 *
 * 지원 워크플로우:
 *   - n8n Webhook 노드 (https://n8n.io)
 *   - Flowise Chatflow (https://flowiseai.com)
 *   - 사내 REST API 엔드포인트
 *   - 어떤 HTTP POST 엔드포인트든 가능
 *
 * Webhook 요청 형식:
 *   POST https://your-endpoint.com/webhook/voice-bot
 *   {
 *     "messages": [
 *       {"role": "system", "content": "..."},
 *       {"role": "user", "content": "배송 언제 오나요?"}
 *     ],
 *     "model": null,
 *     "maxTokens": null,
 *     "temperature": null
 *   }
 *
 * Webhook 응답 형식 (아래 중 아무거나):
 *   {"text": "주문하신 상품은..."}
 *   {"response": "주문하신 상품은..."}
 *   {"message": "주문하신 상품은..."}
 *   {"choices": [{"message": {"content": "..."}}]}  ← OpenAI 호환
 *   또는 plain text body
 *
 * STT: Deepgram Nova-3
 * LLM: WebhookAdapter → n8n (fallback: OpenAI GPT)
 * TTS: ElevenLabs Flash v2.5
 *
 * Run:
 *   cp .env.example .env
 *   npx ts-node examples/08-webhook-n8n-integration.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter, WebhookAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter, GeminiTtsAdapter } from 'dvgateway-adapters/tts';

// ─── 1. 클라이언트 초기화 ───────────────────────────────────────────────────

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth' },
});

// ─── 2. AI 어댑터 설정 ────────────────────────────────────────────────────

const stt = new DeepgramAdapter({
  apiKey: process.env['DEEPGRAM_API_KEY']!,
  language: 'ko',
  model: 'nova-3',
  endpointingMs: 400,
  smartFormat: true,
});

// Fallback LLM — Webhook 장애 시 자동 전환
const fallbackLlm = new OpenAILlmAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  model: 'gpt-4o-mini',  // 빠르고 경제적인 모델 (fallback용)
  systemPrompt: '간단히 답변해주세요. 시스템 장애로 상세 응답이 어렵습니다.',
  maxTokens: 128,
});

// ────────────────────────────────────────────────────────────────────────────
// Webhook LLM — n8n, Flowise, 사내 API 등 외부 서비스에 LLM 로직 위임
//
// ⚡ 장점:
//   - 코드 수정 없이 n8n에서 AI 응답 로직 변경 가능
//   - 다양한 데이터소스 연결 (DB, 스프레드시트, CRM)
//   - 비개발자도 시나리오 편집 가능
//
// ⚠️ 주의:
//   - 네트워크 왕복 지연이 추가됨 (50~200ms)
//   - timeout을 짧게 설정 (5초) + fallback 필수
//   - Webhook 서버 안정성이 통화 품질에 직접 영향
// ────────────────────────────────────────────────────────────────────────────

const webhookLlm = new WebhookAdapter({
  // n8n Webhook URL (대시보드 Pipeline 설정에서도 변경 가능)
  url: process.env['WEBHOOK_URL'] ?? 'https://n8n.company.com/webhook/voice-bot',

  // 타임아웃: 5초 초과 시 fallback으로 자동 전환
  timeout: 5000,

  // HMAC-SHA256 서명: webhook 요청의 위변조 방지
  secret: process.env['WEBHOOK_SECRET'] ?? '',

  // Webhook 장애 시 OpenAI GPT로 자동 전환
  fallback: fallbackLlm,

  // 시스템 프롬프트 (webhook에도 전달됨)
  systemPrompt:
    '당신은 고객 상담 AI입니다. ' +
    '짧고 명확하게 답변하세요.',

  // 추가 HTTP 헤더 (인증 등)
  headers: {
    // 'Authorization': 'Bearer my-api-key',
    // 'X-Custom-Header': 'my-value',
  },
});

const ttsProvider = process.env['TTS_PROVIDER'] ?? 'gemini';

const tts = ttsProvider === 'elevenlabs'
  ? new ElevenLabsAdapter({
      apiKey: process.env['ELEVENLABS_API_KEY']!,
      model: 'eleven_flash_v2_5',
    })
  : new GeminiTtsAdapter({
      apiKey: process.env['GEMINI_API_KEY']!,
    });

// ─── 3. 파이프라인 시작 ──────────────────────────────────────────────────

console.log('🔗 Webhook 연동 AI 음성 봇 시작...');
console.log(`   Webhook URL: ${process.env['WEBHOOK_URL'] ?? '(환경변수 미설정)'}`);
console.log(`   Fallback:    OpenAI GPT-4o-mini (5초 타임아웃 시 자동 전환)`);
console.log('');

await gw.pipeline()
  .stt(stt)
  .llm(webhookLlm)
  .tts(tts)
  .onNewCall((session) => {
    console.log(
      `📞 [${session.linkedId}] 콜 수신: ${session.caller ?? '비공개'}\n` +
      // ── 커스텀 값 (Dynamic VoIP 다이얼플랜에서 전달) ──
      // Dialplan: Set(__CUSTOM_VALUE_01=${customer_name})
      // 용도 예시: 고객명, 주문번호, 통화 목적 등 CRM 연동 데이터
      `   커스텀값1   : ${session.customValue1 ?? '없음'}\n` +
      `   커스텀값2   : ${session.customValue2 ?? '없음'}\n` +
      `   커스텀값3   : ${session.customValue3 ?? '없음'}`
    );
  })
  .onTranscript((result, session) => {
    if (result.isFinal) {
      console.log(`💬 [${session.linkedId}] "${result.text}"`);
    }
  })
  .onCallEnded((linkedId, duration) => {
    console.log(`📴 [${linkedId}] 통화 종료 (${duration}초)`);
  })
  .onError((err, linkedId) => {
    console.error(`❌ [${linkedId ?? 'global'}]`, err.message);
  })
  .start();
