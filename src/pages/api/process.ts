import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { condenseVideo } from "@/lib/ffmpeg";
import type { DetectionMethod } from "@/lib/ffmpeg";
import { ensureStorageFolders, uploadsDir } from "@/lib/storage";

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};

const allowedExtensions = new Set([".mp4", ".mov", ".mkv"]);
const maxFileSizeBytes = 25 * 1024 * 1024 * 1024;

type ApiError = {
  error: string;
};

type ProcessResponse = Omit<Awaited<ReturnType<typeof condenseVideo>>, "outputPath">;

function firstValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function readNumber(value: string | string[] | undefined, fallback: number) {
  const parsed = Number.parseFloat(firstValue(value) ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readDetectionMethod(value: string | string[] | undefined): DetectionMethod {
  return firstValue(value) === "basic" ? "basic" : "voice";
}

function parseFriendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : "Processing failed.";

  if (/ffmpeg is not installed/i.test(message) || /ffprobe is not installed/i.test(message)) {
    return "FFmpeg and ffprobe are required. Install them with Homebrew using: brew install ffmpeg";
  }

  if (/maxFileSize|maxTotalFileSize|bigger than|too large/i.test(message)) {
    return "That file is too large for this MVP. Try a smaller recording first.";
  }

  if (/Invalid file type/i.test(message)) {
    return "Please upload an MP4, MOV, or MKV recording.";
  }

  if (/No audio track|matches no streams|matching stream|does not contain/i.test(message)) {
    return "No audio was detected in this recording. Please export a version with an audio track.";
  }

  return message.length > 600 ? "Processing failed. Try changing the silence settings or using a shorter test clip." : message;
}

async function parseForm(req: NextApiRequest) {
  await ensureStorageFolders();

  const form = formidable({
    uploadDir: uploadsDir,
    keepExtensions: true,
    maxFileSize: maxFileSizeBytes,
    multiples: false,
    filename: (_name, ext, part) => {
      const originalExt = path.extname(part.originalFilename ?? ext).toLowerCase();
      const safeExt = allowedExtensions.has(originalExt) ? originalExt : ext;
      return `${randomUUID()}${safeExt}`;
    },
    filter: (part) => {
      if (part.name !== "video") return true;
      const extension = path.extname(part.originalFilename ?? "").toLowerCase();
      return allowedExtensions.has(extension);
    }
  });

  return new Promise<{ fields: formidable.Fields; files: formidable.Files }>((resolve, reject) => {
    form.parse(req, (error, fields, files) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ fields, files });
    });
  });
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ApiError | ProcessResponse>
) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    res.status(405).json({ error: "Use the upload form to process a recording." });
    return;
  }

  let uploadedPath: string | undefined;

  try {
    const { fields, files } = await parseForm(req);
    const file = Array.isArray(files.video) ? files.video[0] : files.video;

    if (!file) {
      throw new Error("Invalid file type.");
    }

    const extension = path.extname(file.originalFilename ?? file.filepath).toLowerCase();
    if (!allowedExtensions.has(extension)) {
      throw new Error("Invalid file type.");
    }

    uploadedPath = file.filepath;

    const detectionMethod = readDetectionMethod(fields.detectionMethod);
    const silenceThreshold = readNumber(fields.silenceThreshold, -40);
    const minimumSilenceDuration = readNumber(fields.minimumSilenceDuration, 5);
    const padding = readNumber(fields.padding, 2);
    const mergeNearbyGap = readNumber(fields.mergeNearbyGap, 8);

    if (minimumSilenceDuration <= 0 || padding < 0 || mergeNearbyGap < 0) {
      throw new Error("Silence duration must be greater than zero. Padding and merge gap cannot be negative.");
    }

    const { outputPath: _outputPath, ...result } = await condenseVideo(uploadedPath, {
      detectionMethod,
      silenceThresholdDb: silenceThreshold,
      minimumSilenceDuration,
      padding,
      mergeNearbyGap
    });

    res.status(200).json(result);
  } catch (error) {
    res.status(400).json({ error: parseFriendlyError(error) });
  } finally {
    if (uploadedPath) {
      await fs.rm(uploadedPath, { force: true }).catch(() => undefined);
    }
  }
}
