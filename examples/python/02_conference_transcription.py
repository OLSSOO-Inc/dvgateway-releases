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
        print(f"\n[{session.linked_id}] {result.speaker or '알 수 없음'}: \"{result.text}\"")

        # DVGateway 회의록에 자동 저장
        if session.conf_id:
            await gw.submit_transcript(session.conf_id, result)

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
