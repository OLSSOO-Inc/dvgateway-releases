# 모니터링 대시보드 및 감정 분석

## 13. 모니터링 대시보드

서버 설치 후 웹 브라우저에서 `http://your-server:8081` 에 접속하면
실시간 모니터링 대시보드를 볼 수 있습니다.

**대시보드에서 확인 가능한 항목:**

| 항목 | 설명 |
|------|------|
| 활성 통화 수 | 현재 진행 중인 통화 세션 수 |
| VU 미터 | 각 통화의 실시간 음량 레벨 |
| 지연 시간 | STT/LLM/TTS 각 단계별 처리 시간 |
| 전사 로그 | 실시간 발화 텍스트 스트림 |
| 오류 로그 | AI 서비스 오류 및 연결 이슈 |
| 라이선스 상태 | 동시 통화 한도 및 사용량 |

---

## 14. 감정 분석 (Sentiment Analysis) — 실시간 회의 분위기 모니터링

Deepgram Nova-3의 **Sentiment Analysis** 기능을 활용하면, 각 발화(transcript segment)에 대해
**positive / neutral / negative** 감정 분류와 신뢰도 점수(0.0~1.0)를 실시간으로 받을 수 있습니다.

이를 통해 다음과 같은 기능이 가능합니다:

| 기능 | 설명 |
|------|------|
| **실시간 회의 분위기 모니터링** | 스트리밍 화면 참여자 목록에 감정 상태 표시 |
| **회의록 감정 메타데이터** | 회의 종료 후 회의록에 발화별 감정 데이터 포함 |
| **화자별 감정 통계** | 회의 종료 시 화자별 감정 분포 요약 제공 |

---

### Deepgram Sentiment 활성화

Deepgram STT 어댑터에서 `sentiment: true` 옵션을 추가하면 됩니다.
**Nova-3 이상** 모델에서만 지원됩니다.

**Node.js:**

```typescript
import { DeepgramAdapter } from 'dvgateway-adapters/stt';

const stt = new DeepgramAdapter({
  apiKey:   process.env.DEEPGRAM_API_KEY!,
  language: 'ko',
  model:    'nova-3',
  diarize:  true,       // 화자 구분 (sentiment와 함께 사용 권장)
  sentiment: true,      // ← 감정 분석 활성화
});
```

**Python:**

```python
from dvgateway.adapters.stt import DeepgramAdapter

stt = DeepgramAdapter(
    api_key=os.environ["DEEPGRAM_API_KEY"],
    language="ko",
    model="nova-3",
    diarize=True,
    sentiment=True,      # ← 감정 분석 활성화
)
```

활성화하면 `TranscriptResult` 에 `sentiment` 필드가 포함됩니다:

```typescript
interface SentimentResult {
  sentiment: 'positive' | 'neutral' | 'negative';
  sentimentScore: number;  // 0.0 ~ 1.0
}

// TranscriptResult.sentiment 에서 접근
result.sentiment?.sentiment      // 'positive' | 'neutral' | 'negative'
result.sentiment?.sentimentScore // 0.85
```

---

### 실시간 회의 분위기 모니터링

컨퍼런스 스트리밍 화면의 참여자 목록에 **실시간 감정 상태**를 표시할 수 있습니다.
각 참여자의 최근 발화 감정을 실시간으로 추적하여 회의 분위기를 모니터링합니다.

**Node.js:**

```typescript
// 참여자별 실시간 감정 상태 추적
const participantMood = new Map<string, {
  sentiment: string;
  score: number;
  lastUpdated: Date;
}>();

await gw.pipeline()
  .stt(new DeepgramAdapter({
    apiKey:    process.env.DEEPGRAM_API_KEY!,
    language:  'ko',
    model:     'nova-3',
    diarize:   true,
    sentiment: true,
  }))
  .forConference()
  .onTranscript(async (result, session) => {
    if (!result.isFinal) return;

    // 감정 상태 업데이트
    if (result.sentiment) {
      const speakerId = result.speaker ?? session.linkedId;
      participantMood.set(speakerId, {
        sentiment: result.sentiment.sentiment,
        score:     result.sentiment.sentimentScore,
        lastUpdated: new Date(),
      });

      // 감정 이모지 매핑
      const emoji = result.sentiment.sentiment === 'positive' ? '😊'
                   : result.sentiment.sentiment === 'negative' ? '😟'
                   : '😐';

      console.log(
        `${emoji} [${speakerId}] ${result.text} ` +
        `(${result.sentiment.sentiment}, ${(result.sentiment.sentimentScore * 100).toFixed(0)}%)`
      );
    }

    // 회의록에 저장
    if (session.confId) {
      await gw.submitTranscript(session.confId, result);
    }
  })
  .start();

// 전체 회의 분위기 요약 (주기적으로 호출)
function getMeetingMoodSummary(): string {
  const moods = [...participantMood.values()];
  const positive = moods.filter(m => m.sentiment === 'positive').length;
  const negative = moods.filter(m => m.sentiment === 'negative').length;
  const neutral  = moods.filter(m => m.sentiment === 'neutral').length;

  if (negative > moods.length / 2) return '⚠️ 부정적 분위기 감지';
  if (positive > moods.length / 2) return '✅ 긍정적 분위기';
  return '➡️ 보통';
}
```

**Python:**

```python
from collections import defaultdict
from datetime import datetime

participant_mood: dict[str, dict] = {}

async def on_transcript(result, session):
    if not result.is_final:
        return

    if result.sentiment:
        speaker_id = result.speaker or session.linked_id
        participant_mood[speaker_id] = {
            "sentiment": result.sentiment.sentiment,
            "score": result.sentiment.sentiment_score,
            "last_updated": datetime.now(),
        }

        emoji = {"positive": "😊", "neutral": "😐", "negative": "😟"}
        print(
            f"{emoji[result.sentiment.sentiment]} [{speaker_id}] {result.text} "
            f"({result.sentiment.sentiment}, {result.sentiment.sentiment_score:.0%})"
        )

    if session.conf_id:
        await gw.submit_transcript(session.conf_id, result)

await (
    gw.pipeline()
    .stt(DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        diarize=True,
        sentiment=True,
    ))
    .for_conference()
    .on_transcript(on_transcript)
    .start()
)
```

---

### 회의록 감정 메타데이터

회의 종료 후 다운로드하는 회의록(JSON/TXT)에 **발화별 감정 데이터**가 포함됩니다.
`sentiment: true`로 STT를 실행하면 `submitTranscript()` 시 감정 메타데이터가 자동으로 함께 저장됩니다.

**JSON 회의록 예시:**

```json
{
  "confId": "7001",
  "startedAt": "2026-03-15T09:00:00Z",
  "endedAt": "2026-03-15T09:45:00Z",
  "utterances": [
    {
      "timestamp": "2026-03-15T09:01:23Z",
      "linkedId": "ch-001",
      "callerId": "김팀장",
      "text": "이번 분기 실적이 목표를 초과했습니다.",
      "isFinal": true,
      "sentiment": "positive",
      "sentimentScore": 0.92
    },
    {
      "timestamp": "2026-03-15T09:02:45Z",
      "linkedId": "ch-002",
      "callerId": "이과장",
      "text": "하지만 비용 초과가 우려됩니다.",
      "isFinal": true,
      "sentiment": "negative",
      "sentimentScore": 0.78
    }
  ],
  "sentimentSummary": {
    "overall": "neutral",
    "distribution": { "positive": 45, "neutral": 35, "negative": 20 },
    "bySpeaker": {
      "김팀장": { "positive": 60, "neutral": 30, "negative": 10, "avgScore": 0.72 },
      "이과장": { "positive": 20, "neutral": 40, "negative": 40, "avgScore": 0.45 }
    }
  }
}
```

**TXT 회의록 예시:**

```
=== Meeting Minutes ===
Conference ID: 7001
Start: 2026-03-15 09:00:00
End: 2026-03-15 09:45:00
Duration: 45m0s

--- Utterance Log ---

[09:01:23] 김팀장: 이번 분기 실적이 목표를 초과했습니다. [😊 positive 92%]
[09:02:45] 이과장: 하지만 비용 초과가 우려됩니다. [😟 negative 78%]

--- Sentiment Summary ---

Overall: neutral
Distribution: positive 45% | neutral 35% | negative 20%

Speaker Stats:
  김팀장: 😊 positive 60% | 😐 neutral 30% | 😟 negative 10% (avg: 0.72)
  이과장: 😊 positive 20% | 😐 neutral 40% | 😟 negative 40% (avg: 0.45)
```

---

### 화자별 감정 통계

회의 종료 시 화자별로 감정 분포를 집계하여 요약 통계를 생성합니다.

**Node.js:**

```typescript
// 화자별 감정 통계 수집기
class SpeakerSentimentStats {
  private stats = new Map<string, Array<{ sentiment: string; score: number }>>();

  add(speaker: string, sentiment: string, score: number): void {
    if (!this.stats.has(speaker)) {
      this.stats.set(speaker, []);
    }
    this.stats.get(speaker)!.push({ sentiment, score });
  }

  getSummary(): Record<string, {
    total: number;
    positive: number;
    neutral: number;
    negative: number;
    avgScore: number;
    dominantMood: string;
  }> {
    const summary: Record<string, any> = {};
    for (const [speaker, entries] of this.stats) {
      const positive = entries.filter(e => e.sentiment === 'positive').length;
      const neutral  = entries.filter(e => e.sentiment === 'neutral').length;
      const negative = entries.filter(e => e.sentiment === 'negative').length;
      const avgScore = entries.reduce((sum, e) => sum + e.score, 0) / entries.length;

      let dominantMood = 'neutral';
      if (positive >= neutral && positive >= negative) dominantMood = 'positive';
      else if (negative >= neutral && negative >= positive) dominantMood = 'negative';

      summary[speaker] = {
        total: entries.length,
        positive: Math.round((positive / entries.length) * 100),
        neutral:  Math.round((neutral  / entries.length) * 100),
        negative: Math.round((negative / entries.length) * 100),
        avgScore: Math.round(avgScore * 100) / 100,
        dominantMood,
      };
    }
    return summary;
  }
}

// 사용 예
const sentimentStats = new SpeakerSentimentStats();

await gw.pipeline()
  .stt(new DeepgramAdapter({
    apiKey: process.env.DEEPGRAM_API_KEY!,
    language: 'ko', model: 'nova-3',
    diarize: true, sentiment: true,
  }))
  .forConference()
  .onTranscript(async (result, session) => {
    if (!result.isFinal || !result.sentiment) return;

    const speaker = result.speaker ?? session.linkedId;
    sentimentStats.add(speaker, result.sentiment.sentiment, result.sentiment.sentimentScore);
  })
  .start();

// 회의 종료 시
process.on('SIGTERM', () => {
  console.log('\n=== 화자별 감정 통계 ===');
  const summary = sentimentStats.getSummary();
  for (const [speaker, stats] of Object.entries(summary)) {
    console.log(
      `${speaker}: 😊${stats.positive}% 😐${stats.neutral}% 😟${stats.negative}% ` +
      `(평균 점수: ${stats.avgScore}, 주요 분위기: ${stats.dominantMood})`
    );
  }
});
```

**Python:**

```python
from collections import defaultdict

class SpeakerSentimentStats:
    def __init__(self):
        self._stats: dict[str, list[dict]] = defaultdict(list)

    def add(self, speaker: str, sentiment: str, score: float) -> None:
        self._stats[speaker].append({"sentiment": sentiment, "score": score})

    def get_summary(self) -> dict:
        summary = {}
        for speaker, entries in self._stats.items():
            total = len(entries)
            positive = sum(1 for e in entries if e["sentiment"] == "positive")
            neutral  = sum(1 for e in entries if e["sentiment"] == "neutral")
            negative = sum(1 for e in entries if e["sentiment"] == "negative")
            avg_score = sum(e["score"] for e in entries) / total

            dominant = max(
                [("positive", positive), ("neutral", neutral), ("negative", negative)],
                key=lambda x: x[1],
            )[0]

            summary[speaker] = {
                "total": total,
                "positive": round(positive / total * 100),
                "neutral": round(neutral / total * 100),
                "negative": round(negative / total * 100),
                "avg_score": round(avg_score, 2),
                "dominant_mood": dominant,
            }
        return summary

# 사용 예
stats = SpeakerSentimentStats()

async def on_transcript(result, session):
    if not result.is_final or not result.sentiment:
        return
    speaker = result.speaker or session.linked_id
    stats.add(speaker, result.sentiment.sentiment, result.sentiment.sentiment_score)

# 회의 종료 시
summary = stats.get_summary()
for speaker, s in summary.items():
    print(f"{speaker}: 😊{s['positive']}% 😐{s['neutral']}% 😟{s['negative']}% "
          f"(avg: {s['avg_score']}, mood: {s['dominant_mood']})")
```

---

### Sentiment 응용 사례

#### 1. 고객 상담 품질 모니터링

실시간 감정 분석으로 **불만 고객 통화**를 자동 감지하여 상위 관리자에게 알림을 보냅니다.

```typescript
.onTranscript(async (result, session) => {
  if (!result.isFinal || !result.sentiment) return;

  // 부정 감정이 연속 3회 이상 감지되면 알림
  if (result.sentiment.sentiment === 'negative' && result.sentiment.sentimentScore > 0.7) {
    negativeCount++;
    if (negativeCount >= 3) {
      await sendAlert({
        type: 'negative_sentiment',
        linkedId: session.linkedId,
        caller: session.caller,
        message: '고객 불만 감지 — 관리자 개입 필요',
      });
    }
  } else {
    negativeCount = 0;
  }
})
```

#### 2. 교육·세미나 참여도 분석

온라인 강의에서 학습자의 **반응(긍정/부정)** 을 실시간으로 추적합니다.

```
강사 발언 → 학습자 반응 자동 집계:
  "이해했습니다" → positive (0.89)
  "잘 모르겠어요" → negative (0.72)
  "네" → neutral (0.51)
────────────────────────────────
실시간 참여도 대시보드: 😊 65% | 😐 25% | 😟 10%
```

#### 3. 면접·채용 인터뷰 분석

면접 후 지원자의 발화 감정 흐름을 리포트로 생성합니다.

```
시간대별 감정 변화:
  09:00–09:10 자기소개  → 😊 positive (자신감)
  09:10–09:20 기술 질문 → 😐 neutral  (신중한 답변)
  09:20–09:30 압박 질문 → 😟 negative (긴장)
  09:30–09:35 마무리    → 😊 positive (회복)
```

#### 4. 의료 상담 감정 추적

원격 진료에서 환자의 심리 상태를 자동으로 기록합니다.

| 시간 | 환자 발화 | 감정 | 점수 |
|------|---------|------|------|
| 14:01 | "최근에 잠을 잘 못 자요" | negative | 0.82 |
| 14:03 | "약을 먹으면 좀 나아져요" | positive | 0.67 |
| 14:05 | "그런데 부작용이 걱정돼요" | negative | 0.75 |

---

