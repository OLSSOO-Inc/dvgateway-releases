/**
 * Example 9: AI 응대 + 확인 문자 — "말로 안내하고, 문자로 남긴다"
 *
 * 영업시간 외(또는 부재중) 걸려온 전화를 AI 봇이 받아 예약을 접수하고,
 * 예약이 확정되는 순간 **건 사람의 휴대폰으로 확인 문자(SMS)** 를 보냅니다.
 * AI 통화와 SMS 가 같은 게이트웨이·같은 대표번호에서 나가는 조합입니다.
 *
 * 동작 원리 (마커 프로토콜):
 *   1. LLM 시스템 프롬프트에 "예약 확정 시 응답 끝에 [SMS|날짜시간|이름] 태그를
 *      붙여라"라고 지시합니다.
 *   2. onAfterChat 훅이 태그를 감지하면 — 태그를 제거한 텍스트만 TTS 로 재생하고
 *      (고객에게 태그가 읽히지 않음), 발신자 번호로 확인 SMS 를 보냅니다.
 *
 * 사전 조건:
 *   - SMS 라우팅 설정 완료 (가이드 21-sms.md §0 — 미설정 시 412 sms_disabled)
 *   - 발신자(caller)가 휴대폰 번호로 수신되는 환경 (비공개 발신은 문자 생략)
 *   - 본문은 EUC-KR 80바이트(한글 40자) 이내 — 아래 buildSmsText 참고
 *
 * STT: Deepgram Nova-3 (Korean) · LLM: OpenAI GPT-4o-mini · TTS: Gemini
 *
 * Run:
 *   cp .env.example .env   # DV_BASE_URL, DV_API_KEY, DEEPGRAM/OPENAI/GEMINI 키
 *   SMS_FROM_EXT=1001 npx ts-node examples/09-ai-sms-confirmation.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import type { Message, HookContext } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
import { GeminiTtsAdapter } from 'dvgateway-adapters/tts';

// ─── 0. 클라이언트 + 어댑터 ────────────────────────────────────────────────

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth' },
});

// SMS 발신 내선 — 게이트웨이가 이 내선의 실제 번호(external CID)로 발신합니다.
const SMS_FROM_EXT = process.env['SMS_FROM_EXT'] ?? '1001';

const stt = new DeepgramAdapter({
  apiKey: process.env['DEEPGRAM_API_KEY']!,
  language: 'ko',
  model: 'nova-3',
  endpointingMs: 400,
});

const llm = new OpenAILlmAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  model: 'gpt-4o-mini',
  systemPrompt:
    '당신은 OLSSOO 치과의 영업시간 외 예약 접수원입니다. ' +
    '지금은 영업시간이 아니므로: 예약 희망 날짜/시간과 성함만 정중히 확인하세요. ' +
    '답변은 1-2문장으로 짧게. ' +
    // ── 마커 프로토콜: 예약이 확정되면(날짜·시간·이름 모두 확인되면) 응답의
    //    맨 끝에 아래 형식의 태그를 정확히 한 번 붙인다. 태그는 고객에게
    //    읽히지 않으며 시스템이 확인 문자를 보내는 신호다.
    '예약 확정 시에만 응답 맨 끝에 [SMS|MM/DD HH:mm|이름] 태그를 붙이세요. ' +
    '예: "예약되었습니다. 확인 문자를 보내드릴게요.[SMS|07/12 14:00|홍길동]"',
  maxTokens: 256,
  temperature: 0.3,
});

const tts = new GeminiTtsAdapter({ apiKey: process.env['GEMINI_API_KEY']! });

// ─── 1. 통화별 상태 ─────────────────────────────────────────────────────────

const callerByLinkedId = new Map<string, string>(); // linkedId → 발신자 번호
const smsSent = new Set<string>();                  // 통화당 1회만 발송

// ─── 2. 확인 문자 본문 (EUC-KR 80바이트 = 한글 40자 이내로 설계) ─────────────

function buildSmsText(when: string, name: string): string {
  // 예: "[예약확정] 07/12 14:00 홍길동님. 변경은 이 번호로 전화주세요"  (≈60바이트)
  return `[예약확정] ${when} ${name}님. 변경은 이 번호로 전화주세요`;
}

// ─── 3. 파이프라인 ──────────────────────────────────────────────────────────

console.log('🌙 영업시간 외 AI 예약 접수 봇 (확인 문자 발송) 시작...\n');

const SMS_TAG = /\[SMS\|([^|\]]+)\|([^\]]+)\]/;

await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)

  .onNewCall(async (session) => {
    console.log(`📞 [${session.linkedId}] 새 콜: ${session.caller ?? '비공개'}`);
    if (session.caller) callerByLinkedId.set(session.linkedId, session.caller);
  })

  // ── 예약 확정 감지 → 태그 제거 + 확인 SMS 발송 ──
  .onAfterChat(async (response: string, _messages: Message[], ctx: HookContext): Promise<string> => {
    const m = response.match(SMS_TAG);
    if (!m) return response; // 아직 확정 아님 — 그대로 재생

    const spoken = response.replace(SMS_TAG, '').trim(); // 태그는 TTS 로 읽지 않음
    const [, when, name] = m;
    const linkedId = ctx.session.linkedId;
    const caller = callerByLinkedId.get(linkedId);

    if (!caller) {
      console.log(`   ⚠️ [${linkedId}] 발신자 번호 없음(비공개) — 문자 생략`);
      return spoken;
    }
    if (smsSent.has(linkedId)) return spoken; // 통화당 1회

    smsSent.add(linkedId);
    try {
      const res = await gw.sendSMS({
        from: SMS_FROM_EXT,           // 내선 → 실제 대표번호로 자동 변환
        to: [caller],
        text: buildSmsText(when.trim(), name.trim()),
      });
      console.log(`   📩 [${linkedId}] 확인 문자 발송: ${caller} (${res['status']})`);
    } catch (e: any) {
      // SMS 미설정(412 sms_disabled 등)이어도 통화는 계속 — 문자만 생략.
      console.error(`   ❌ [${linkedId}] 문자 발송 실패: ${e.message}`);
      smsSent.delete(linkedId); // 다음 턴 재시도 허용
    }
    return spoken;
  })

  .onCallEnded((linkedId, duration) => {
    console.log(`📴 [${linkedId}] 통화 종료 (${duration}초)\n`);
    callerByLinkedId.delete(linkedId);
    smsSent.delete(linkedId);
  })

  .onError((err, linkedId) => {
    console.error(`❌ [${linkedId ?? 'global'}]`, err.message);
  })

  .start();
