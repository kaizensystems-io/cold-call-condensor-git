# Cold Call Condenser

Cold Call Condenser is a local-first MVP for trimming long call recordings down to useful audio clips.

Upload an `.mp4`, `.mov`, or `.mkv` file, choose silence settings if needed, and the app exports a condensed MP4 from the detected audio clips.

The current default mode is tuned for cold-call review: it preserves larger clips and removes only
meaningful dead air like dialing, ringing, long pauses, and time between calls.

## Requirements

- macOS
- Node.js 20 or newer
- npm
- FFmpeg and ffprobe
- Python 3.8 or newer for Voice Detection mode

## Install FFmpeg on macOS

If you use Homebrew:

```bash
brew install ffmpeg
```

Confirm both tools are available:

```bash
ffmpeg -version
ffprobe -version
```

## Install Voice Detection Dependencies

Cold Call Condenser now supports two local detection methods:

- **Voice Detection**: the default. Uses Silero VAD to detect human speech, which helps avoid clips caused by typing, ringing, clicks, and background noise.
- **Basic Silence Detection**: the original FFmpeg `silencedetect` pipeline. It remains available in Advanced Settings as a fallback.

Silero VAD runs locally and does not require a paid API, cloud upload, transcription, or an LLM. The app calls a small Python helper in `scripts/silero_vad.py`, preferring Silero's ONNX runtime path.

Install the local VAD dependencies:

```bash
python3 -m pip install -r requirements-vad.txt
```

Silero's project lists Python 3.8+, `onnxruntime>=1.16.1` for ONNX model usage, and notes that ONNX can run faster on CPU. Source: [Silero VAD](https://github.com/snakers4/silero-vad).

If Voice Detection fails or is not installed, the app automatically falls back to Basic Silence Detection and shows a warning.

## Setup

Install dependencies:

```bash
npm install
```

Run the local app:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## How To Use

1. Choose a call recording in `.mp4`, `.mov`, or `.mkv` format.
2. Keep Advanced Settings closed unless you need manual tuning:
   - Detection method: `Voice Detection`
   - Silence threshold: `-40dB`
   - Minimum silence duration: `5 seconds`
   - Padding before/after speech: `2 seconds`
   - Merge nearby speech gaps: `8 seconds`
3. Click **Condense Recording**.
4. Download the processed MP4 when the result appears.

For cold-call recordings, higher minimum silence and merge gap values preserve larger clips instead
of splitting normal back-and-forth into sentence-level clips. The defaults are tuned to remove meaningful dead
air like dialing, ringing, and long pauses.

After processing, the app shows:

- Original duration
- Condensed duration
- Time removed
- Clips found
- Percentage reduction
- Preview cards for each clip
- Download links for the full condensed video and each individual clip
- Delete controls for removing individual clips after review
- A local beta feedback prompt

## How To Test

Start with a short 1-3 minute sample before trying a full cold calling session.

Good test cases:

- A recording with speech, silence, and more speech.
- A recording with no audio track.
- A recording that is mostly silence.
- A recording with no detected silence.
- A non-video file renamed with the wrong extension.

Suggested FFmpeg test clip:

```bash
ffmpeg -f lavfi -i testsrc=size=1280x720:rate=30 \
  -f lavfi -i "sine=frequency=1000:duration=4" \
  -f lavfi -i "anullsrc=channel_layout=stereo:sample_rate=44100:duration=3" \
  -f lavfi -i "sine=frequency=700:duration=4" \
  -filter_complex "[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]" \
  -map 0:v -map "[a]" -t 11 -pix_fmt yuv420p sample-cold-call.mp4
```

Then upload `sample-cold-call.mp4`.

## npm Scripts

```bash
npm run dev
npm run build
npm run start
npm run typecheck
npm run lint
```

## Local Storage

The app uses local folders only:

- `storage/uploads` for temporary uploaded recordings
- `storage/tmp` for temporary segment files
- `storage/outputs` for processed MP4 downloads and individual clips

These folders are created automatically. Uploaded source files are removed after processing. Processed outputs remain available for download until you delete them.

Beta feedback is stored in browser `localStorage` under `cold-call-condenser-feedback`.

## Notes

- There is no login, database, payment system, transcription, or cloud deployment.
- There are no paid APIs. Voice Detection runs locally with Silero VAD.
- Large files can take a while because each clip is re-encoded for reliable MP4 concatenation.
- If processing removes too much speech, lower the silence threshold, for example from `-40dB` to `-45dB`.
- If processing keeps too much dead air, raise the silence threshold, for example from `-40dB` to `-35dB`.
- If useful audio is split into too many clips, increase minimum silence or merge nearby speech gaps.
- If unrelated calls are being joined together, lower merge nearby speech gaps.

## Future Feature Structure

- Future feature placeholders live in `src/lib/roadmap.ts`.
- Planned future features include AI voicemail detection, AI clip detection, AI objection tagging, call search, and transcription.
