# Cold Call Condenser

Cold Call Condenser is a local-first MVP for trimming long OBS cold calling recordings down to the parts that contain audio or speech.

Upload an `.mp4`, `.mov`, or `.mkv` file, choose silence settings, and the app exports a condensed MP4 from the detected talking segments.

## Requirements

- macOS
- Node.js 20 or newer
- npm
- FFmpeg and ffprobe

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

1. Choose an OBS recording in `.mp4`, `.mov`, or `.mkv` format.
2. Keep the default settings for a first test:
   - Silence threshold: `-35dB`
   - Minimum silence duration: `1.2 seconds`
   - Padding before/after speech: `0.3 seconds`
3. Click **Upload and Condense**.
4. Download the processed MP4 when the result appears.

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
- `storage/outputs` for processed MP4 downloads

These folders are created automatically. Uploaded source files are removed after processing. Processed outputs remain available for download until you delete them.

## Notes

- There is no login, database, payment system, transcription, or cloud deployment.
- Large files can take a while because each talking segment is re-encoded for reliable MP4 concatenation.
- If processing removes too much speech, lower the silence threshold, for example from `-35dB` to `-45dB`.
- If processing keeps too much dead air, raise the silence threshold, for example from `-35dB` to `-30dB`.
