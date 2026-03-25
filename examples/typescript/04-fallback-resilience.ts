/**
 * Example 4: 서비스 지속성 — Fallback 체인 + 자동 복구
 *
 * AI 서비스 장애 시 자동으로 대체 서비스로 전환합니다:
 *   Deepgram 장애 → OpenAI Whisper
 *   OpenAI GPT 장애 → Claude Sonnet (fallback)
 *   ElevenLabs 장애 → OpenAI TTS
 *
 * Run:
 *   npx ts-node examples/04-fallback-resilience.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';
import { OpenAILlmAdapter, AnthropicAdapter } from 'dvgateway-adapters/llm';
import { ElevenLabsAdapter, OpenAITtsAdapter } from 'dvgateway-adapters/tts';
import type { SttAdapter, AudioChunk, TranscriptResult } from 'dvgateway-sdk';

// ─── Whisper STT Fallback (HTTP polling 방식) ─────────────────────────────

/**
 * 간단한 OpenAI Whisper 어댑터 — Deepgram 대비 레이턴시는 높지만
 * 폴백용으로 충분합니다.
 */
class WhisperFallbackAdapter implements SttAdapter {
  private handler: ((r: TranscriptResult) => void) | null = null;
  private stopped = false;
  private buffer: Float32Array[] = [];

  constructor(private readonly apiKey: string) {}

  onTranscript(handler: (r: TranscriptResult) => void): void {
    this.handler = handler;
  }

  async startStream(linkedId: string, audioStream: AsyncIterable<AudioChunk>): Promise<void> {
    // Buffer 3초 단위로 Whisper API 호출
    let bufferedMs = 0;
    const FLUSH_MS = 3000;

    for await (const chunk of audioStream) {
      if (this.stopped) break;

      this.buffer.push(chunk.samples);
      bufferedMs += chunk.durationMs;

      if (bufferedMs >= FLUSH_MS) {
        await this.flushToWhisper(linkedId);
        this.buffer = [];
        bufferedMs = 0;
      }
    }

    // Flush remaining
    if (this.buffer.length > 0) {
      await this.flushToWhisper(linkedId);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
  }

  private async flushToWhisper(linkedId: string): Promise<void> {
    if (!this.handler || this.buffer.length === 0) return;

    try {
      // Merge all buffers
      const totalSamples = this.buffer.reduce((sum, b) => sum + b.length, 0);
      const merged = new Float32Array(totalSamples);
      let offset = 0;
      for (const buf of this.buffer) {
        merged.set(buf, offset);
        offset += buf.length;
      }

      // Convert to WAV and send to Whisper
      const wavBuffer = float32ToWav(merged, 16000);
      const formData = new FormData();
      formData.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'audio.wav');
      formData.append('model', 'whisper-1');
      formData.append('language', 'ko');

      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: formData,
      });

      if (!response.ok) return;

      const data = (await response.json()) as { text: string };
      if (!data.text) return;

      this.handler({
        linkedId,
        text: data.text,
        isFinal: true,
        timestampMs: Date.now(),
      });
    } catch {
      // Ignore transcription errors in fallback mode
    }
  }
}

// ─── 클라이언트 설정 ──────────────────────────────────────────────────────

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: { type: 'apiKey', apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth' },
  reconnect: {
    maxAttempts: 20,
    initialDelayMs: 2000,
    maxDelayMs: 30_000,
    onReconnect: (n) => console.warn(`[재연결] 시도 #${n}`),
  },
});

// ─── Fallback 체인 설정 ────────────────────────────────────────────────────

console.log('🛡️  Fallback 체인 음성 봇 시작...');
console.log('   STT:  Deepgram → Whisper (fallback)');
console.log('   LLM:  GPT-4o-mini → Claude Sonnet (fallback)');
console.log('   TTS:  ElevenLabs → OpenAI TTS (fallback)\n');

await gw.pipeline()
  .stt(new DeepgramAdapter({ apiKey: process.env['DEEPGRAM_API_KEY']!, language: 'ko' }))
    // .fallback(new WhisperFallbackAdapter(process.env['OPENAI_API_KEY']!))  // Deepgram 장애 시
  .llm(new OpenAILlmAdapter({
    apiKey: process.env['OPENAI_API_KEY']!,
    model: 'gpt-4o-mini',
    systemPrompt: '친절한 AI 상담원입니다. 짧게 답변하세요.',
  }))
    // .fallback(new AnthropicAdapter({ apiKey: process.env['ANTHROPIC_API_KEY']! }))  // GPT 장애 시
  .tts(new ElevenLabsAdapter({ apiKey: process.env['ELEVENLABS_API_KEY']!, model: 'eleven_flash_v2_5' }))
    // .fallback(new OpenAITtsAdapter({ apiKey: process.env['OPENAI_API_KEY']! }))  // ElevenLabs 장애 시
  .onNewCall((s) => {
    console.log(
      `📞 [${s.linkedId}] 콜 수신\n` +
      // ── 커스텀 값 (Dynamic VoIP 다이얼플랜에서 전달) ──
      // Dialplan: Set(__CUSTOM_VALUE_01=${customer_name})
      // 용도 예시: 고객명, 주문번호, 통화 목적 등 CRM 연동 데이터
      `   커스텀값1   : ${s.customValue1 ?? '없음'}\n` +
      `   커스텀값2   : ${s.customValue2 ?? '없음'}\n` +
      `   커스텀값3   : ${s.customValue3 ?? '없음'}`
    );
  })
  .onError((err, id) => console.error(`❌ [${id}]`, err.message))
  .start();


// ─── WAV 변환 유틸 ────────────────────────────────────────────────────────

function float32ToWav(samples: Float32Array, sampleRate: number): Buffer {
  const bytesPerSample = 2;
  const dataLength = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataLength);

  // WAV header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);                // chunk size
  buffer.writeUInt16LE(1, 20);                 // PCM
  buffer.writeUInt16LE(1, 22);                 // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32);    // block align
  buffer.writeUInt16LE(16, 34);                // bits per sample
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataLength, 40);

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }

  return buffer;
}
