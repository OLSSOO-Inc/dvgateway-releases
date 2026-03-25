/**
 * Example 2: Conference Real-time Transcription + Minutes + Sentiment
 *
 * Transcribes all participants in a ConfBridge conference in real-time.
 * Features:
 *   - Speaker diarization (화자 분리)
 *   - Real-time sentiment analysis (감정 분석)
 *   - Auto-save to DVGateway minutes store (with sentiment metadata)
 *   - Per-speaker sentiment statistics (화자별 감정 통계)
 *   - Download minutes as JSON or TXT after call
 *   - Live caption injection to YouTube stream
 *
 * Run:
 *   npx ts-node examples/02-conference-transcription.ts
 */

import 'dotenv/config';
import { DVGatewayClient } from 'dvgateway-sdk';
import { DeepgramAdapter } from 'dvgateway-adapters/stt';

const gw = new DVGatewayClient({
  baseUrl: process.env['DV_BASE_URL'] ?? 'http://localhost:8080',
  auth: {
    type:   'apiKey',
    apiKey: process.env['DV_API_KEY'] ?? 'dev-no-auth',
  },
});

const stt = new DeepgramAdapter({
  apiKey:   process.env['DEEPGRAM_API_KEY']!,
  language: 'ko',
  model:    'nova-3',
  diarize:  true,           // 화자 분리: Speaker 0, Speaker 1, ...
  sentiment: true,          // 감정 분석: positive/neutral/negative
  endpointingMs: 500,
});

// 화자별 감정 통계 추적
const speakerSentiments = new Map<string, Array<{ sentiment: string; score: number }>>();

console.log('📝  컨퍼런스 자막/회의록/감정분석 서비스 시작...\n');

await gw.pipeline()
  .stt(stt)
  .forConference()          // LLM/TTS 없이 STT만 (회의록 모드)
  .onTranscript(async (result, session) => {
    if (!result.isFinal) {
      // 실시간 자막 (부분 결과)
      process.stdout.write(`\r🎤 [${result.speaker ?? '?'}] ${result.text}              `);
      return;
    }

    // 감정 이모지 매핑
    const sentimentEmoji = result.sentiment
      ? result.sentiment.sentiment === 'positive' ? '😊'
      : result.sentiment.sentiment === 'negative' ? '😟'
      : '😐'
      : '';

    const sentimentInfo = result.sentiment
      ? ` [${sentimentEmoji} ${result.sentiment.sentiment} ${(result.sentiment.sentimentScore * 100).toFixed(0)}%]`
      : '';

    // 최종 발화 출력 (감정 포함)
    console.log(
      `\n✅ [${session.linkedId}] ${result.speaker ?? '알 수 없음'}: "${result.text}"${sentimentInfo}`
    );

    // 화자별 감정 통계 수집
    if (result.sentiment) {
      const speaker = result.speaker ?? session.linkedId;
      if (!speakerSentiments.has(speaker)) {
        speakerSentiments.set(speaker, []);
      }
      speakerSentiments.get(speaker)!.push({
        sentiment: result.sentiment.sentiment,
        score: result.sentiment.sentimentScore,
      });
    }

    // 1. DVGateway 회의록에 자동 저장 (감정 메타데이터 포함)
    if (session.confId) {
      await gw.submitTranscript(session.confId, result);
    }

    // 2. YouTube 스트리밍 자막 업데이트 (옵션)
    // await updateYouTubeCaption(session.confId!, result.text);
  })
  .onError((err, linkedId) => {
    console.error(`❌ [${linkedId ?? 'global'}] 오류:`, err.message);
  })
  .start();

// ─── 회의 종료 시 화자별 감정 통계 출력 ─────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('\n=== 화자별 감정 통계 ===');
  for (const [speaker, entries] of speakerSentiments) {
    const total = entries.length;
    const positive = entries.filter(e => e.sentiment === 'positive').length;
    const neutral  = entries.filter(e => e.sentiment === 'neutral').length;
    const negative = entries.filter(e => e.sentiment === 'negative').length;
    const avgScore = entries.reduce((sum, e) => sum + e.score, 0) / total;

    console.log(
      `  ${speaker}: 😊${Math.round(positive / total * 100)}% ` +
      `😐${Math.round(neutral / total * 100)}% ` +
      `😟${Math.round(negative / total * 100)}% ` +
      `(평균 점수: ${avgScore.toFixed(2)})`
    );
  }
});

// ─── 회의 종료 후 회의록 다운로드 (별도 트리거) ────────────────────────────

// 예: 특정 컨퍼런스 ID의 회의록 다운로드 (감정 메타데이터 포함)
// const minutes = await gw.downloadMinutes('7001', 'txt');
// console.log(minutes);

// 또는 JSON 형식으로 (sentimentSummary 포함)
// const minutesJson = await gw.downloadMinutes('7001', 'json');
// await fs.writeFile('meeting-7001.json', minutesJson);
