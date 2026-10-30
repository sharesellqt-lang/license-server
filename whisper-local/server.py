
import os
import json
import tempfile
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel

app = FastAPI(title="IVS Local Whisper")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "IVS_ALLOWED_ORIGINS",
        "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

model = WhisperModel("small", device="cpu", compute_type="int8")


def ndjson(data):
    return json.dumps(data, ensure_ascii=False) + "\n"


@app.get("/health")
def health():
    return {"ok": True, "service": "IVS Local Whisper", "model": "small"}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("auto"),
):
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    temp_path = None

    try:
        with tempfile.NamedTemporaryFile(
            delete=False, suffix=suffix
        ) as temp:
            temp_path = temp.name
            while chunk := await file.read(1024 * 1024):
                temp.write(chunk)
        await file.close()
    except Exception as exc:
        if temp_path and os.path.exists(temp_path):
            os.remove(temp_path)
        await file.close()
        raise HTTPException(
            status_code=500,
            detail=f"Không thể lưu file audio: {exc}",
        ) from exc

    def generate():
        try:
            yield ndjson({
                "type": "progress",
                "percent": 2,
                "status": "Đã nhận audio, đang khởi tạo Whisper..."
            })

            selected_language = (
                None if language in ("", "auto", "other") else language
            )

            segments, info = model.transcribe(
                temp_path,
                language=selected_language,
                word_timestamps=True,
                vad_filter=True,
                beam_size=5,
            )

            duration = max(
                0.0,
                float(getattr(info, "duration", 0) or 0)
            )
            results = []
            last_percent = 2

            yield ndjson({
                "type": "progress",
                "percent": 5,
                "status": "Whisper đang nhận diện lời nói..."
            })

            for segment in segments:
                words = []
                for word in segment.words or []:
                    words.append({
                        "start": float(word.start),
                        "end": float(word.end),
                        "word": word.word,
                    })

                results.append({
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "text": segment.text.strip(),
                    "words": words,
                })

                if duration > 0:
                    percent = min(
                        95,
                        max(5, int(5 + 90 * segment.end / duration))
                    )
                    if percent > last_percent:
                        last_percent = percent
                        yield ndjson({
                            "type": "progress",
                            "percent": percent,
                            "status": (
                                f"Whisper đang xử lý audio "
                                f"({percent}%)..."
                            )
                        })

            yield ndjson({
                "type": "done",
                "data": {
                    "ok": True,
                    "language": info.language,
                    "language_probability": float(info.language_probability),
                    "segments": results,
                }
            })

        except Exception as exc:
            yield ndjson({
                "type": "error",
                "detail": f"Whisper transcription failed: {exc}"
            })

        finally:
            if temp_path and os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except OSError:
                    pass

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
