"""
Example 2: Conference Real-time Transcription + Minutes

Transcribes all participants in a ConfBridge conference in real-time.
Features:
  - Speaker diarization (화자 분리)
  - Auto-save to DVGateway minutes store
  - Download minutes as JSON or TXT after call

Run:
  python examples/python/02_conference_transcription.py
"""

import asyncio
import os
import sys

from dotenv import load_dotenv

from dvgateway import DVGatewayClient
from dvgateway.adapters.stt import DeepgramAdapter

load_dotenv()


async def main() -> None:
    gw = DVGatewayClient(
        base_url=os.environ.get("DV_BASE_URL", "http://localhost:8080"),
        auth={
            "type": "apiKey",
            "api_key": os.environ.get("DV_API_KEY", "dev-no-auth"),
        },
    )

    stt = DeepgramAdapter(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        language="ko",
        model="nova-3",
        diarize=True,
        endpointing_ms=500,
    )

    print("컨퍼런스 자막/회의록 서비스 시작...\n")

    async def on_transcript(result, session):
        if not result.is_final:
            # 실시간 자막 (부분 결과)
            sys.stdout.write(f"\r[{result.speaker or '?'}] {result.text}              ")
            sys.stdout.flush()
            return

        # 최종 발화 출력
        # 참고: session.custom_value_1/2/3 으로 다이얼플랜 커스텀 값 접근 가능
        # 예: 화자 이름 매핑에 custom_value_1 (고객명) 활용
        print(f"\n[{session.linked_id}] {result.speaker or '알 수 없음'}: \"{result.text}\"")

        # 회의록: 게이트웨이가 자체 STT(POST /api/v1/stt/conf/{confId})로 직접 만든다.
        # SDK 가 전사를 제출하는 API 는 없다(submit_transcript() 는 DVGatewayUnsupportedError).
        # 회의록은 await gw.download_minutes(session.conf_id) 로 읽는다
        # (진행 중=실시간, 종료 후=저장본 · 게이트웨이 1.4.16.285+).

    await (
        gw.pipeline()
        .stt(stt)
        .for_conference()
        .on_transcript(on_transcript)
        .on_error(lambda err, linked_id=None: print(f"[{linked_id or 'global'}] 오류: {err}"))
        .start()
    )


if __name__ == "__main__":
    asyncio.run(main())
