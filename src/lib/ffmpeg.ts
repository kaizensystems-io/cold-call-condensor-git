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

type SilenceRange = {
  start: number;
  end: number;
};

export type CondenseOptions = {
  silenceThresholdDb: number;
  minimumSilenceDuration: number;
  padding: number;
  mergeNearbyGap: number;
};

export type CondenseResult = {
  originalDuration: number;
  condensedDuration: number;
  removedDuration: number;
  segmentCount: number;
  outputFilename: string;
  outputPath: string;
  segments: Segment[];
  warning?: string;
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
  const silences = await detectSilences(inputPath, originalDuration, options);
  let warning: string | undefined;

  if (silences.length === 0) {
    warning = "No silence was detected, so the output keeps the full recording.";
  }

  const segments =
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

  if (segments.length === 0) {
    throw new Error("No talking segments were found. Try lowering the silence threshold or reducing the minimum silence duration.");
  }

  const jobId = randomUUID();
  const workDir = path.join(tmpDir, jobId);
  await fs.mkdir(workDir, { recursive: true });

  const outputFilename = `${jobId}-condensed.mp4`;
  const outputPath = path.join(outputsDir, outputFilename);

  try {
    const segmentPaths: string[] = [];

    for (const segment of segments) {
      const segmentPath = path.join(workDir, `segment-${String(segment.index).padStart(4, "0")}.mp4`);
      await cutSegment(inputPath, segmentPath, segment);
      segmentPaths.push(segmentPath);
    }

    await concatenateSegments(segmentPaths, outputPath, workDir);
    await assertNonEmptyOutput(outputPath);

    const condensedDuration = await getVideoDuration(outputPath);

    return {
      originalDuration: Number(originalDuration.toFixed(3)),
      condensedDuration: Number(condensedDuration.toFixed(3)),
      removedDuration: Number(Math.max(0, originalDuration - condensedDuration).toFixed(3)),
      segmentCount: segments.length,
      outputFilename,
      outputPath,
      segments,
      warning
    };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}
