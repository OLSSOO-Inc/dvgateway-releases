/**
 * Example 6: Text Input → TTS Playback (텍스트 입력 → TTS 재생)
 *
 * 터미널에서 텍스트를 입력하면 활성 통화에 TTS로 재생합니다.
 * 실시간 안내 방송, 수동 메시지 전달, 디버깅 등에 활용할 수 있습니다.
 *
 * 기능:
 *   - 터미널 프롬프트에서 텍스트 입력 → ElevenLabs TTS 합성 → 통화에 주입
 *   - 활성 콜 목록 조회 (/list)
 *   - 특정 콜 지정 재생 (/select <linkedId>)
 *   - 전체 활성 콜에 브로드캐스트 (/all)
 *   - 종료 (/quit)
 *
 * DVGateway ports:
 *   :8080 — API server (this SDK connects here)
 *   :8092 — Media server (Dynamic VoIP connects here, GW_MEDIA_ADDR)
 *   :8088 — Dynamic VoIP ARI (DVGateway connects to Dynamic VoIP here)
 *
 * Run:
 *   cp .env.example .env  # fill in your API keys
 *   npx ts-node examples/06-text-input-tts.ts
 */

import 'dotenv/config';
import * as readline from 'node:readline';
import { DVGatewayClient } from 'dvgateway-sdk';
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

// ─── 2. TTS 어댑터 설정 ─────────────────────────────────────────────────────

const tts = new ElevenLabsAdapter({
  apiKey:  process.env['ELEVENLABS_API_KEY']!,
  voiceId: process.env['ELEVENLABS_VOICE_ID'] ?? '21m00Tcm4TlvDq8ikWAM',
  model:   'eleven_flash_v2_5',       // 최저 지연 (~75ms)
});

// ─── 3. 활성 콜 추적 ────────────────────────────────────────────────────────

const activeCalls = new Map<string, { caller?: string; startedAt: Date }>();
let selectedLinkedId: string | null = null;

gw.onCallEvent((event) => {
  if (event.type === 'call:new') {
    const { session } = event;
    activeCalls.set(session.linkedId, {
      caller: session.caller,
      startedAt: session.startedAt,
    });
    console.log(`\n📞 새 콜 수신: [${session.linkedId}] ${session.caller ?? '알 수 없음'}`);

    // 첫 번째 콜이면 자동 선택
    if (activeCalls.size === 1) {
      selectedLinkedId = session.linkedId;
      console.log(`   → 자동 선택됨 (유일한 활성 콜)`);
    }

    promptUser();
  }

  if (event.type === 'call:ended') {
    activeCalls.delete(event.linkedId);
    console.log(`\n📴 콜 종료: [${event.linkedId}] (${event.durationSec}초)`);

    if (selectedLinkedId === event.linkedId) {
      selectedLinkedId = activeCalls.size > 0
        ? activeCalls.keys().next().value ?? null
        : null;
      if (selectedLinkedId) {
        console.log(`   → 선택 콜 변경: [${selectedLinkedId}]`);
      }
    }

    promptUser();
  }
});

// ─── 4. TTS 재생 함수 ───────────────────────────────────────────────────────

async function playTts(linkedId: string, text: string): Promise<void> {
  console.log(`🔊 TTS 재생 중... [${linkedId}] "${text}"`);
  const startMs = Date.now();

  try {
    await gw.injectTts(linkedId, tts.synthesize(text));
    const elapsed = Date.now() - startMs;
    console.log(`✅ TTS 재생 완료 (${elapsed}ms)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`❌ TTS 재생 실패: ${message}`);
  }
}

async function broadcastTts(text: string): Promise<void> {
  if (activeCalls.size === 0) {
    console.log('⚠️  활성 콜이 없습니다.');
    return;
  }

  console.log(`🔊 전체 브로드캐스트 중... (${activeCalls.size}개 콜)`);
  const promises = Array.from(activeCalls.keys()).map((id) => playTts(id, text));
  await Promise.allSettled(promises);
}

// ─── 5. CLI 명령어 처리 ─────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  DVGateway 텍스트 → TTS 재생기                             ║
╠═══════════════════════════════════════════════════════════╣
║  텍스트 입력    → 선택된 콜에 TTS 재생                      ║
║  /list         → 활성 콜 목록                              ║
║  /select <id>  → 재생 대상 콜 선택                          ║
║  /all          → 브로드캐스트 모드 (다음 입력을 전체 콜에 전송)  ║
║  /help         → 도움말                                    ║
║  /quit         → 종료                                      ║
╚═══════════════════════════════════════════════════════════╝
`);
}

function listCalls(): void {
  if (activeCalls.size === 0) {
    console.log('📋 활성 콜 없음. 전화가 오면 자동으로 표시됩니다.');
    return;
  }

  console.log(`📋 활성 콜 목록 (${activeCalls.size}개):`);
  for (const [id, info] of activeCalls) {
    const marker = id === selectedLinkedId ? ' ← 선택됨' : '';
    console.log(`   [${id}] ${info.caller ?? '알 수 없음'}${marker}`);
  }
}

let broadcastMode = false;

async function handleInput(line: string): Promise<void> {
  const trimmed = line.trim();
  if (!trimmed) return;

  // 명령어 처리
  if (trimmed === '/help') {
    printHelp();
    return;
  }

  if (trimmed === '/list') {
    listCalls();
    return;
  }

  if (trimmed === '/quit' || trimmed === '/exit') {
    console.log('👋 종료합니다...');
    gw.close();
    process.exit(0);
  }

  if (trimmed.startsWith('/select')) {
    const id = trimmed.split(/\s+/)[1];
    if (!id) {
      console.log('⚠️  사용법: /select <linkedId>');
      listCalls();
      return;
    }
    if (!activeCalls.has(id)) {
      console.log(`⚠️  콜 [${id}]을(를) 찾을 수 없습니다.`);
      listCalls();
      return;
    }
    selectedLinkedId = id;
    console.log(`✅ 선택됨: [${id}]`);
    return;
  }

  if (trimmed === '/all') {
    broadcastMode = true;
    console.log('📢 브로드캐스트 모드 활성화 — 다음 입력이 모든 활성 콜에 전송됩니다.');
    return;
  }

  // TTS 재생
  if (broadcastMode) {
    broadcastMode = false;
    await broadcastTts(trimmed);
    return;
  }

  if (!selectedLinkedId) {
    console.log('⚠️  활성 콜이 없습니다. 전화가 오면 자동으로 선택됩니다.');
    return;
  }

  if (!activeCalls.has(selectedLinkedId)) {
    console.log(`⚠️  선택된 콜 [${selectedLinkedId}]이(가) 종료되었습니다.`);
    selectedLinkedId = null;
    return;
  }

  await playTts(selectedLinkedId, trimmed);
}

// ─── 6. readline 인터페이스 ─────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function promptUser(): void {
  const target = broadcastMode
    ? '📢 전체'
    : selectedLinkedId
      ? `🎯 ${selectedLinkedId.slice(0, 8)}...`
      : '⏳ 대기 중';

  rl.setPrompt(`[${target}] TTS> `);
  rl.prompt();
}

rl.on('line', async (line) => {
  await handleInput(line);
  promptUser();
});

rl.on('close', () => {
  console.log('\n👋 종료합니다...');
  gw.close();
  process.exit(0);
});

// ─── 7. 시작 ────────────────────────────────────────────────────────────────

printHelp();
console.log('📡 게이트웨이:', process.env['DV_BASE_URL'] ?? 'http://localhost:8080');
console.log('🔊 TTS 엔진: ElevenLabs Flash v2.5');
console.log('🔊 콜을 기다리는 중...\n');
promptUser();

// Graceful shutdown
process.on('SIGTERM', () => {
  rl.close();
  gw.close();
  process.exit(0);
});
