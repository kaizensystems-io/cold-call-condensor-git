import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ensureStorageFolders, outputsDir, tmpDir } from "./storage";

export type Segment = {
  index: number;
  start: number;
  end: number;
  duration: number;
};

export type Clip = Segment & {
  filename: string;
};

type SilenceRange = {
  start: number;
  end: number;
};

type SpeechRange = {
  start: number;
  end: number;
};

export type DetectionMethod = "voice" | "basic";

export type CondenseOptions = {
  detectionMethod: DetectionMethod;
  silenceThresholdDb: number;
  minimumSilenceDuration: number;
  padding: number;
  mergeNearbyGap: number;
};

export type CondenseResult = {
  originalDuration: number;
  condensedDuration: number;
  removedDuration: number;
  reductionPercentage: number;
  clipCount: number;
  outputFilename: string;
  outputPath: string;
  clips: Clip[];
  warning?: string;
  detectionMethodUsed: DetectionMethod;
};

const minimumIsolatedSpeechSeconds = 2;

function runCommand(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(new Error(`${command} is not installed or is not available on your PATH.`));
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} failed. ${stderr.trim() || "No extra details were returned."}`));
    });
  });
}

export async function getVideoDuration(inputPath: string) {
  const { stdout } = await runCommand("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    inputPath
  ]);

  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not read the video duration. Please try a different recording.");
  }

  return duration;
}

async function detectSilences(inputPath: string, originalDuration: number, options: CondenseOptions) {
  const noise = `${options.silenceThresholdDb}dB`;
  const duration = String(options.minimumSilenceDuration);

  const { stderr } = await runCommand("ffmpeg", [
    "-hide_banner",
    "-i",
    inputPath,
    "-af",
    `silencedetect=noise=${noise}:d=${duration}`,
    "-f",
    "null",
    "-"
  ]);

  if (/Stream map .* matches no streams|does not contain any stream/i.test(stderr)) {
    throw new Error("No audio track was detected in this file.");
  }

  return parseSilenceRanges(stderr, originalDuration);
}

async function extractVadWav(inputPath: string, outputPath: string) {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-i",
    inputPath,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-f",
    "wav",
    outputPath
  ]);
}

async function detectSpeechWithSilero(inputPath: string, workDir: string) {
  const wavPath = path.join(workDir, "vad-input.wav");
  await extractVadWav(inputPath, wavPath);

  const pythonCommand = process.env.COLD_CALL_CONDENSER_PYTHON || "python3";
  const scriptPath = path.join(process.cwd(), "scripts", "silero_vad.py");
  const { stdout, stderr } = await runCommand(pythonCommand, [scriptPath, wavPath]);
  const rawOutput =
    stdout
      .trim()
      .split(/\r?\n/)
      .reverse()
      .find((line) => line.trim().startsWith("{")) ?? "";

  if (!rawOutput) {
    throw new Error(stderr.trim() || "Silero VAD did not return speech timestamps.");
  }

  let parsed: { speech?: SpeechRange[]; error?: string };
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    throw new Error("Silero VAD returned an unreadable response.");
  }

  if (parsed.error) {
    throw new Error(parsed.error);
  }

  return (parsed.speech ?? []).filter((range) => range.end > range.start);
}

export function parseSilenceRanges(output: string, originalDuration?: number) {
  const ranges: SilenceRange[] = [];
  let openStart: number | null = null;
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      openStart = Number.parseFloat(startMatch[1]);
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (endMatch && openStart !== null) {
      const end = Number.parseFloat(endMatch[1]);
      if (Number.isFinite(openStart) && Number.isFinite(end) && end > openStart) {
        ranges.push({ start: openStart, end });
      }
      openStart = null;
    }
  }

  if (openStart !== null && originalDuration && originalDuration > openStart) {
    ranges.push({ start: openStart, end: originalDuration });
  }

  return ranges;
}

export function buildTalkingSegments(
  silences: SilenceRange[],
  originalDuration: number,
  padding: number,
  mergeNearbyGap: number
): Segment[] {
  const sortedSilences = silences
    .filter((silence) => silence.end > silence.start)
    .sort((a, b) => a.start - b.start);

  type InternalSegment = {
    start: number;
    end: number;
    coreStart: number;
    coreEnd: number;
    speechDuration: number;
  };

  const rawSegments: InternalSegment[] = [];
  let cursor = 0;

  for (const silence of sortedSilences) {
    const speechStart = cursor;
    const speechEnd = Math.max(0, Math.min(originalDuration, silence.start));
    const speechDuration = speechEnd - speechStart;

    if (speechDuration > 0) {
      rawSegments.push({
        start: Math.max(0, speechStart - padding),
        end: Math.min(originalDuration, speechEnd + padding),
        coreStart: speechStart,
        coreEnd: speechEnd,
        speechDuration
      });
    }

    cursor = Math.max(cursor, Math.min(originalDuration, silence.end));
  }

  const finalSpeechDuration = originalDuration - cursor;
  if (finalSpeechDuration > 0) {
    rawSegments.push({
      start: Math.max(0, cursor - padding),
      end: originalDuration,
      coreStart: cursor,
      coreEnd: originalDuration,
      speechDuration: finalSpeechDuration
    });
  }

  const merged = rawSegments.reduce<InternalSegment[]>((acc, segment) => {
    const previous = acc.at(-1);

    if (!previous || segment.coreStart - previous.coreEnd >= mergeNearbyGap) {
      acc.push(segment);
      return acc;
    }

    previous.end = Math.max(previous.end, segment.end);
    previous.coreEnd = Math.max(previous.coreEnd, segment.coreEnd);
    previous.speechDuration += segment.speechDuration;
    return acc;
  }, []);

  return merged
    .filter((segment) => segment.speechDuration >= minimumIsolatedSpeechSeconds)
    .map((segment, index) => ({
      index: index + 1,
      start: Number(segment.start.toFixed(3)),
      end: Number(segment.end.toFixed(3)),
      duration: Number((segment.end - segment.start).toFixed(3))
    }));
}

export function buildClipsFromSpeechRanges(
  speechRanges: SpeechRange[],
  originalDuration: number,
  padding: number,
  mergeNearbyGap: number
): Segment[] {
  type InternalSegment = {
    start: number;
    end: number;
    coreStart: number;
    coreEnd: number;
    speechDuration: number;
  };

  const rawSegments = speechRanges
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)
    .map<InternalSegment>((range) => {
      const coreStart = Math.max(0, Math.min(originalDuration, range.start));
      const coreEnd = Math.max(coreStart, Math.min(originalDuration, range.end));

      return {
        start: Math.max(0, coreStart - padding),
        end: Math.min(originalDuration, coreEnd + padding),
        coreStart,
        coreEnd,
        speechDuration: coreEnd - coreStart
      };
    })
    .filter((segment) => segment.speechDuration > 0);

  const merged = rawSegments.reduce<InternalSegment[]>((acc, segment) => {
    const previous = acc.at(-1);

    if (!previous || segment.coreStart - previous.coreEnd >= mergeNearbyGap) {
      acc.push(segment);
      return acc;
    }

    previous.end = Math.max(previous.end, segment.end);
    previous.coreEnd = Math.max(previous.coreEnd, segment.coreEnd);
    previous.speechDuration += segment.speechDuration;
    return acc;
  }, []);

  return merged
    .filter((segment) => segment.speechDuration >= minimumIsolatedSpeechSeconds)
    .map((segment, index) => ({
      index: index + 1,
      start: Number(segment.start.toFixed(3)),
      end: Number(segment.end.toFixed(3)),
      duration: Number((segment.end - segment.start).toFixed(3))
    }));
}

async function cutSegment(inputPath: string, outputPath: string, segment: Segment) {
  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-ss",
    String(segment.start),
    "-i",
    inputPath,
    "-t",
    String(segment.duration),
    "-avoid_negative_ts",
    "make_zero",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-c:a",
    "aac",
    "-b:a",
    "160k",
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

async function concatenateSegments(segmentPaths: string[], outputPath: string, workDir: string) {
  const listPath = path.join(workDir, "segments.txt");
  const listBody = segmentPaths.map((segmentPath) => `file '${segmentPath.replaceAll("'", "'\\''")}'`).join("\n");
  await fs.writeFile(listPath, listBody, "utf8");

  await runCommand("ffmpeg", [
    "-hide_banner",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-c",
    "copy",
    "-movflags",
    "+faststart",
    outputPath
  ]);
}

async function assertNonEmptyOutput(outputPath: string) {
  const stats = await fs.stat(outputPath).catch(() => null);
  if (!stats || stats.size === 0) {
    throw new Error("The processed video was empty. Try a lower silence threshold or shorter minimum silence duration.");
  }
}

export async function condenseVideo(inputPath: string, options: CondenseOptions): Promise<CondenseResult> {
  await ensureStorageFolders();

  const originalDuration = await getVideoDuration(inputPath);
  let warning: string | undefined;
  let detectionMethodUsed: DetectionMethod = options.detectionMethod;

  const jobId = randomUUID();
  const workDir = path.join(tmpDir, jobId);
  await fs.mkdir(workDir, { recursive: true });

  const outputFilename = `${jobId}-full-condensed.mp4`;
  const outputPath = path.join(outputsDir, outputFilename);

  try {
    let segments: Segment[] = [];

    if (options.detectionMethod === "voice") {
      try {
        const speechRanges = await detectSpeechWithSilero(inputPath, workDir);
        segments = buildClipsFromSpeechRanges(speechRanges, originalDuration, options.padding, options.mergeNearbyGap);

        if (speechRanges.length === 0) {
          throw new Error("Silero VAD did not detect any human speech.");
        }

        if (segments.length === 0) {
          throw new Error("Silero VAD only detected tiny isolated speech fragments.");
        }
      } catch (error) {
        detectionMethodUsed = "basic";
        const message = error instanceof Error ? error.message : "Silero VAD failed.";
        warning = `Voice Detection was unavailable, so Basic Silence Detection was used instead. ${message}`;
      }
    }

    if (detectionMethodUsed === "basic") {
      const silences = await detectSilences(inputPath, originalDuration, options);

      if (silences.length === 0) {
        warning = warning
          ? `${warning} No silence was detected, so the output keeps the full recording.`
          : "No silence was detected, so the output keeps the full recording.";
      }

      segments =
        silences.length === 0
          ? [
              {
                index: 1,
                start: 0,
                end: Number(originalDuration.toFixed(3)),
                duration: Number(originalDuration.toFixed(3))
              }
            ]
          : buildTalkingSegments(silences, originalDuration, options.padding, options.mergeNearbyGap);
    }

    if (segments.length === 0) {
      throw new Error("No audio clips were found. Try Basic Silence Detection or adjust Advanced Settings.");
    }

    const segmentPaths: string[] = [];
    const clips: Clip[] = [];

    for (const segment of segments) {
      const clipFilename = `${jobId}-clip-${String(segment.index).padStart(3, "0")}.mp4`;
      const segmentPath = path.join(outputsDir, clipFilename);
      await cutSegment(inputPath, segmentPath, segment);
      segmentPaths.push(segmentPath);
      clips.push({
        ...segment,
        filename: clipFilename
      });
    }

    await concatenateSegments(segmentPaths, outputPath, workDir);
    await assertNonEmptyOutput(outputPath);

    const condensedDuration = await getVideoDuration(outputPath);

    return {
      originalDuration: Number(originalDuration.toFixed(3)),
      condensedDuration: Number(condensedDuration.toFixed(3)),
      removedDuration: Number(Math.max(0, originalDuration - condensedDuration).toFixed(3)),
      reductionPercentage: Number((((originalDuration - condensedDuration) / originalDuration) * 100).toFixed(1)),
      clipCount: clips.length,
      outputFilename,
      outputPath,
      clips,
      warning,
      detectionMethodUsed
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
