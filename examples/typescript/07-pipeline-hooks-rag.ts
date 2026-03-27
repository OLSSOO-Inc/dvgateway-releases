/**
 * Example 7: Pipeline Hooks — RAG 컨텍스트 주입 + DB 연동 + 히스토리 관리
 *
 * onBeforeChat / onAfterChat 훅을 사용하여:
 *   1. 사용자 발화 시 벡터 DB에서 관련 문서를 검색하여 LLM 컨텍스트에 주입 (RAG)
 *   2. 사내 REST API에서 고객 정보를 조회하여 개인화 응대
 *   3. 대화 히스토리를 DB에 저장 (상담 기록 보관)
 *   4. maxTurns로 대화 히스토리 자동 관리
 *
 * STT: Deepgram Nova-3 (Korean)
 * LLM: OpenAI GPT-4o-mini (streaming) + RAG context injection (Changed from Claude)
 * TTS: ElevenLabs Flash v2.5
 *
 * Architecture:
 *
 *   고객 발화 → STT → onBeforeChat ─┬→ 벡터DB 검색 (RAG)
 *                                     ├→ 사내API 고객정보 조회
 *                                     └→ 컨텍스트 주입된 messages
 *                                            ↓
 *                                          LLM → onAfterChat ─→ DB 저장
 *                                            ↓
 *                                          TTS → 통화 재생
 *
 * Run:
 *   cp .env.example .env  # fill in your API keys
 *   npx ts-node examples/07-pipeline-hooks-rag.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import type { Message, HookContext } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter } from 'dvgateway-adapters/llm';
// NOTE: AnthropicAdapter → OpenAILlmAdapter 변경 (GPT-4o-mini 사용)
import { ElevenLabsAdapter, GeminiTtsAdapter } from 'dvgateway-adapters/tts';

// ─── 0. 사내 시스템 시뮬레이션 ──────────────────────────────────────────────

/**
 * [예시] 벡터 DB 검색 — Pinecone, Qdrant, ChromaDB 등으로 교체 가능
 *
 * 실제 구현 시:
 *   import { Pinecone } from '@pinecone-database/pinecone';
 *   const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY! });
 *   const index = pc.index('faq-docs');
 */
async function searchVectorDB(query: string): Promise<string[]> {
  // ─── 실제 구현 예시 (Pinecone) ──────────────────────────────
  //
  // const embedding = await openai.embeddings.create({
  //   model: 'text-embedding-3-small',
  //   input: query,
  // });
  // const results = await index.query({
  //   vector: embedding.data[0].embedding,
  //   topK: 3,
  //   includeMetadata: true,
  // });
  // return results.matches.map(m => m.metadata?.text as string);
  //
  // ─── 시뮬레이션 ─────────────────────────────────────────────

  console.log(`   🔍 [벡터DB] 검색: "${query.slice(0, 40)}..."`);
  // FAQ 문서 시뮬레이션
  const faqDocs: Record<string, string> = {
    '배송': '배송은 주문 후 2-3일 소요됩니다. 제주·도서 지역은 1-2일 추가됩니다.',
    '반품': '반품은 수령 후 7일 이내 가능합니다. 고객센터에서 반품 접수 후 택배 수거합니다.',
    '교환': '동일 상품 교환은 무료이며, 다른 상품 교환 시 차액이 발생할 수 있습니다.',
    '결제': '신용카드, 계좌이체, 카카오페이, 네이버페이를 지원합니다.',
    '영업시간': '평일 09:00~18:00, 토요일 09:00~13:00, 일요일·공휴일은 휴무입니다.',
  };

  const results: string[] = [];
  for (const [keyword, doc] of Object.entries(faqDocs)) {
    if (query.includes(keyword)) results.push(doc);
  }

  // 관련 문서가 없으면 기본 안내
  if (results.length === 0) {
    results.push('고객센터 운영시간: 평일 09:00~18:00');
  }

  console.log(`   📄 [벡터DB] ${results.length}건 검색됨`);
  return results;
}

/**
 * [예시] 사내 CRM API — 고객 정보 조회
 *
 * 실제 구현 시:
 *   const res = await fetch(`https://crm.company.com/api/customers/${phone}`, {
 *     headers: { 'Authorization': `Bearer ${CRM_TOKEN}` },
 *   });
 *   return res.json();
 */
interface CustomerInfo {
  name: string;
  tier: string;
  lastOrder?: string;
  openTickets: number;
}

async function lookupCustomer(callerNumber: string): Promise<CustomerInfo | null> {
  console.log(`   👤 [CRM] 고객 조회: ${callerNumber}`);

  // ─── 실제 구현 예시 ─────────────────────────────────────────
  //
  // try {
  //   const res = await fetch(`${CRM_API_URL}/customers/by-phone/${callerNumber}`, {
  //     headers: { Authorization: `Bearer ${CRM_TOKEN}` },
  //     signal: AbortSignal.timeout(3000),  // 3초 타임아웃 (음성 지연 방지)
  //   });
  //   if (!res.ok) return null;
  //   return res.json();
  // } catch {
  //   return null;  // CRM 장애 시 기본 응대
  // }
  //
  // ─── 시뮬레이션 ─────────────────────────────────────────────

  if (callerNumber.endsWith('1234')) {
    return { name: '김철수', tier: 'VIP', lastOrder: '노트북 Pro 15', openTickets: 1 };
  }
  return { name: '고객', tier: 'Standard', openTickets: 0 };
}

/**
 * [예시] 대화 기록 DB 저장 — PostgreSQL, MySQL, MongoDB 등으로 교체 가능
 *
 * 실제 구현 시:
 *   await db.query(
 *     'INSERT INTO conversations (linked_id, turn, role, content, timestamp) VALUES ($1, $2, $3, $4, NOW())',
 *     [linkedId, turnNumber, role, content]
 *   );
 */
async function saveConversation(
  linkedId: string,
  turnNumber: number,
  userText: string,
  assistantText: string
): Promise<void> {
  console.log(`   💾 [DB] 대화 저장: turn=${turnNumber}, linkedId=${linkedId.slice(0, 8)}...`);

  // ─── 실제 구현 예시 (PostgreSQL) ────────────────────────────
  //
  // import { Pool } from 'pg';
  // const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  //
  // await pool.query(
  //   `INSERT INTO conversations (linked_id, turn_number, user_text, assistant_text, created_at)
  //    VALUES ($1, $2, $3, $4, NOW())`,
  //   [linkedId, turnNumber, userText, assistantText]
  // );
  //
  // ─── 시뮬레이션 ─────────────────────────────────────────────
  // (실제로는 DB에 저장)
}

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

const llm = new OpenAILlmAdapter({
  apiKey: process.env['OPENAI_API_KEY']!,
  model: 'gpt-4o-mini',
  systemPrompt:
    '당신은 OLSSOO Inc.의 AI 고객 상담원입니다. ' +
    '제공된 [참고 문서]와 [고객 정보]를 활용하여 정확하게 답변하세요. ' +
    '문서에 없는 내용은 "확인 후 안내드리겠습니다"라고 답하세요. ' +
    '답변은 1-2문장으로 짧게 해주세요.',
  maxTokens: 256,
  temperature: 0.3, // RAG 용도로 낮은 temperature
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

// ─── 3. 통화별 고객 정보 캐시 ──────────────────────────────────────────────

const customerCache = new Map<string, CustomerInfo | null>();

// ─── 4. 파이프라인 시작 ─────────────────────────────────────────────────────

console.log('🎙️  RAG + DB 연동 AI 음성 봇 시작...\n');

await gw.pipeline()
  .stt(stt)
  .llm(llm)
  .tts(tts)

  // ── onNewCall: 통화 시작 시 고객 정보 사전 조회 (1번만) ──
  .onNewCall(async (session) => {
    console.log(
      `📞 [${session.linkedId}] 새 콜: ${session.caller ?? '비공개'}\n` +
      // ── 커스텀 값 (Dynamic VoIP 다이얼플랜에서 전달) ──
      // Dialplan: Set(__CUSTOM_VALUE_01=${customer_name})
      // 용도 예시: 고객명, 주문번호, 통화 목적 등 CRM 연동 데이터
      `   커스텀값1   : ${session.customValue1 ?? '없음'}\n` +
      `   커스텀값2   : ${session.customValue2 ?? '없음'}\n` +
      `   커스텀값3   : ${session.customValue3 ?? '없음'}`
    );

    // CRM에서 고객 정보 조회 (미리 캐시)
    const customer = await lookupCustomer(session.caller ?? '');
    customerCache.set(session.linkedId, customer);

    if (customer) {
      console.log(`   👤 고객: ${customer.name} (${customer.tier})`);
    }
  })

  // ── onBeforeChat: LLM 호출 전 컨텍스트 주입 ──
  .onBeforeChat(async (messages: Message[], ctx: HookContext): Promise<Message[]> => {
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    if (!lastUserMsg) return messages;

    console.log(`\n🔗 [Hook:onBeforeChat] turn=${ctx.turnNumber}`);

    // 1) 벡터 DB에서 관련 문서 검색
    const docs = await searchVectorDB(lastUserMsg.content);

    // 2) 캐시된 고객 정보 가져오기
    const customer = customerCache.get(ctx.session.linkedId);

    // 3) 컨텍스트를 시스템 메시지로 주입
    const contextMessage: Message = {
      role: 'system',
      content:
        `[참고 문서]\n${docs.join('\n')}\n\n` +
        `[고객 정보]\n` +
        `이름: ${customer?.name ?? '미확인'}\n` +
        `등급: ${customer?.tier ?? '일반'}\n` +
        (customer?.lastOrder ? `최근 주문: ${customer.lastOrder}\n` : '') +
        (customer?.openTickets ? `진행 중 문의: ${customer.openTickets}건` : ''),
    };

    // 시스템 프롬프트 바로 뒤에 컨텍스트 삽입
    const systemIdx = messages.findIndex((m) => m.role === 'system');
    const result = [...messages];
    result.splice(systemIdx + 1, 0, contextMessage);
    return result;
  })

  // ── onAfterChat: LLM 응답 후 DB 저장 + 후처리 ──
  .onAfterChat(async (response: string, messages: Message[], ctx: HookContext): Promise<string> => {
    console.log(`🔗 [Hook:onAfterChat] turn=${ctx.turnNumber}`);

    // DB에 대화 기록 저장
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
    await saveConversation(
      ctx.session.linkedId,
      ctx.turnNumber,
      lastUserMsg?.content ?? '',
      response
    );

    // 응답 텍스트를 수정할 수도 있음 (예: 민감 정보 마스킹)
    return response;
  })

  // ── 히스토리 관리: 20턴 초과 시 자동 트리밍 ──
  .history({
    maxTurns: 20,
    summarizeOnTrim: true, // 이전 대화 요약 생성
  })

  .onCallEnded((linkedId, duration) => {
    console.log(`📴 [${linkedId}] 통화 종료 (${duration}초)\n`);
    customerCache.delete(linkedId); // 캐시 정리
  })

  .onError((err, linkedId) => {
    console.error(`❌ [${linkedId ?? 'global'}]`, err.message);
  })

  .start();
