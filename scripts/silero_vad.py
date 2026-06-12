#!/usr/bin/env python3
"""Run Silero VAD locally and print speech timestamps as JSON.

The Next.js backend extracts mono 16 kHz WAV first, then calls this script.
The script prefers Silero's ONNX runtime path to avoid running a PyTorch model.
"""

from __future__ import annotations

import argparse
import json
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Detect speech ranges with Silero VAD.")
    parser.add_argument("wav_path", help="Path to a mono 16 kHz WAV file")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--min-speech-ms", type=int, default=250)
    parser.add_argument("--min-silence-ms", type=int, default=500)
    parser.add_argument("--speech-pad-ms", type=int, default=80)
    args = parser.parse_args()

    try:
        from silero_vad import get_speech_timestamps, load_silero_vad, read_audio
    except ImportError as exc:
        print(
            json.dumps(
                {
                    "error": (
                        "Silero VAD is not installed. Install local VAD dependencies with: "
                        "python3 -m pip install silero-vad onnxruntime soundfile"
                    )
                }
            ),
            file=sys.stderr,
        )
        return 2

    try:
        model = load_silero_vad(onnx=True)
        wav = read_audio(args.wav_path, sampling_rate=16000)
        timestamps = get_speech_timestamps(
            wav,
            model,
            sampling_rate=16000,
            threshold=args.threshold,
            min_speech_duration_ms=args.min_speech_ms,
            min_silence_duration_ms=args.min_silence_ms,
            speech_pad_ms=args.speech_pad_ms,
            return_seconds=True,
        )
    except Exception as exc:  # pragma: no cover - surfaced to the Node API.
        print(json.dumps({"error": f"Silero VAD failed: {exc}"}), file=sys.stderr)
        return 3

    speech_ranges = [
        {"start": round(float(item["start"]), 3), "end": round(float(item["end"]), 3)}
        for item in timestamps
        if float(item["end"]) > float(item["start"])
    ]
    print(json.dumps({"speech": speech_ranges}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
