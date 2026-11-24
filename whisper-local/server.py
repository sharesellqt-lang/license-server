import os
import json
import tempfile
import threading
from pathlib import Path

import whisperx

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel


app = FastAPI(title="IVS Local Whisper")

allowed_origins = [
    origin.strip()
    for origin in os.getenv(
        "IVS_ALLOWED_ORIGINS",
        "https://sharesell.net,https://www.sharesell.net,http://localhost:3000,http://127.0.0.1:3000"
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

# WHISPER
model = WhisperModel("small", device="cpu", compute_type="int8")

# VIETNAMESE ALIGNMENT
ALIGN_DEVICE = "cpu"
ALIGN_LANGUAGE = "vi"
ALIGN_MODEL_NAME = "nguyenvulebinh/wav2vec2-base-vi-vlsp2020"

align_model = None
align_metadata = None
align_lock = threading.Lock()


def ndjson(data):
    return json.dumps(data, ensure_ascii=False) + "\n"


def get_align_model():
    global align_model, align_metadata

    if align_model is None or align_metadata is None:
        print("[ALIGN] Loading Vietnamese alignment model...", flush=True)

        align_model, align_metadata = whisperx.load_align_model(
            language_code=ALIGN_LANGUAGE,
            device=ALIGN_DEVICE,
            model_name=ALIGN_MODEL_NAME,
        )

        print("[ALIGN] Model loaded successfully", flush=True)

    return align_model, align_metadata


def save_upload(file, suffix):
    temp = tempfile.NamedTemporaryFile(
        delete=False,
        suffix=suffix
    )

    temp_path = temp.name

    try:
        while chunk := file.file.read(1024 * 1024):
            temp.write(chunk)
    finally:
        temp.close()

    return temp_path


@app.get("/health")
def health():
    return {
        "ok": True,
        "service": "IVS Local Whisper",
        "model": "small",
        "alignment": "whisperx",
        "alignment_language": "vi",
    }


# =====================================================
# WHISPER TRANSCRIPTION
# =====================================================

@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("auto"),
):
    suffix = Path(file.filename or "audio.wav").suffix or ".wav"
    temp_path = None

    try:
        temp_path = save_upload(file, suffix)
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
            vad_filter=False,
            beam_size=5,
            best_of=5,
            condition_on_previous_text=True,
            no_speech_threshold=0.8,
            log_prob_threshold=-1.0,
            compression_ratio_threshold=2.8,
            hallucination_silence_threshold=2.0,
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
                        "probability": getattr(word, "probability", None),
                    })

                item = {
                    "start": float(segment.start),
                    "end": float(segment.end),
                    "text": segment.text.strip(),
                    "words": words,
                    "no_speech_prob": float(segment.no_speech_prob),
                    "avg_logprob": float(segment.avg_logprob),
                    "compression_ratio": float(segment.compression_ratio),
                }

                results.append(item)

                print(
                    f"[WHISPER] {item['start']:.2f}-{item['end']:.2f}s "
                    f"| no_speech={item['no_speech_prob']:.3f} "
                    f"| logprob={item['avg_logprob']:.3f} "
                    f"| compression={item['compression_ratio']:.3f} "
                    f"| text={item['text']}",
                    flush=True,
                )

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
                            "status": f"Whisper đang xử lý audio ({percent}%)..."
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
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        },
    )


# =====================================================
# VIETNAMESE FORCED ALIGNMENT
# =====================================================

@app.post("/align")
async def align_transcript(
    file: UploadFile = File(...),
    segments: str = Form(...),
    language: str = Form("vi"),
):
    temp_path = None

    try:
        if language != "vi":
            raise HTTPException(
                status_code=400,
                detail="Hiện chỉ hỗ trợ căn chỉnh tiếng Việt."
            )

        try:
            input_segments = json.loads(segments)
        except json.JSONDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail="Dữ liệu segments không hợp lệ."
            ) from exc

        if not isinstance(input_segments, list) or not input_segments:
            raise HTTPException(
                status_code=400,
                detail="Không có đoạn lời cần căn chỉnh."
            )

        prepared_segments = []

        for index, item in enumerate(input_segments):
            start = float(item.get("start", -1))
            end = float(item.get("end", -1))
            text = str(item.get("text", "")).strip()

            if start < 0 or end <= start or not text:
                raise HTTPException(
                    status_code=400,
                    detail=f"Đoạn lời {index} không có thời gian hoặc nội dung hợp lệ."
                )

            prepared_segments.append({
                "start": start,
                "end": end,
                "text": text,
            })

        suffix = Path(file.filename or "audio.wav").suffix or ".wav"
        temp_path = save_upload(file, suffix)
        await file.close()

        print(
            f"[ALIGN] Received {len(prepared_segments)} segments",
            flush=True,
        )

        with align_lock:
            current_model, current_metadata = get_align_model()

            result = whisperx.align(
                prepared_segments,
                current_model,
                current_metadata,
                temp_path,
                ALIGN_DEVICE,
                interpolate_method="ignore",
                return_char_alignments=False,
            )

        aligned_segments = result.get("segments", [])
        aligned_words = result.get("word_segments", [])

        input_word_count = sum(
            len(item["text"].split())
            for item in prepared_segments
        )

        aligned_time_count = sum(
            1
            for word in aligned_words
            if word.get("start") is not None
            and word.get("end") is not None
            and float(word["end"]) > float(word["start"])
        )

        missing_time_count = len(aligned_words) - aligned_time_count

        print(
            f"[ALIGN DIAGNOSTIC] "
            f"Input words: {input_word_count} | "
            f"Output words: {len(aligned_words)} | "
            f"Timed words: {aligned_time_count} | "
            f"Missing timestamps: {missing_time_count}",
            flush=True,
        )

        success_count = sum(
            1
            for word in aligned_words
            if word.get("start") is not None
            and word.get("end") is not None
            and float(word["end"]) > float(word["start"])
        )

        print(
            f"[ALIGN] Completed: {success_count}/{len(aligned_words)} words",
            flush=True,
        )

        return {
            "ok": True,
            "language": language,
            "segments": aligned_segments,
            "words": aligned_words,
            "statistics": {
                "total_words": len(aligned_words),
                "aligned_words": success_count,
                "unaligned_words": len(aligned_words) - success_count,
            },
        }

    except HTTPException:
        raise

    except Exception as exc:
        print(f"[ALIGN ERROR] {exc}", flush=True)

        raise HTTPException(
            status_code=500,
            detail=f"Alignment failed: {exc}",
        ) from exc

    finally:
        if temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass

        await file.close()