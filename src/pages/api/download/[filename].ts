import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import { safeOutputPath } from "@/lib/storage";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const filename = Array.isArray(req.query.filename) ? req.query.filename[0] : req.query.filename;
  const preview = req.query.preview === "1";

  if (!filename || !filename.endsWith(".mp4")) {
    res.status(400).json({ error: "Invalid download link." });
    return;
  }

  const outputPath = safeOutputPath(filename);

  if (!fs.existsSync(outputPath)) {
    res.status(404).json({ error: "The processed video could not be found. Please process the recording again." });
    return;
  }

  if (req.method === "DELETE") {
    try {
      fs.rmSync(outputPath, { force: true });
      res.status(200).json({ ok: true });
    } catch {
      res.status(500).json({ error: "Could not delete this clip. Please try again." });
    }
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET, DELETE");
    res.status(405).json({ error: "Use GET to download or DELETE to remove a clip." });
    return;
  }

  const stat = fs.statSync(outputPath);
  if (stat.size === 0) {
    res.status(500).json({ error: "The processed video is empty. Please process the recording again." });
    return;
  }

  const range = req.headers.range;
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Disposition", `${preview ? "inline" : "attachment"}; filename="${filename}"`);

  if (range) {
    const [startText, endText] = range.replace(/bytes=/, "").split("-");
    const start = Number.parseInt(startText, 10);
    const end = endText ? Number.parseInt(endText, 10) : stat.size - 1;

    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= stat.size || end >= stat.size || start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${stat.size}`).end();
      return;
    }

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": end - start + 1
    });

    fs.createReadStream(outputPath, { start, end }).pipe(res);
    return;
  }

  res.setHeader("Content-Length", stat.size);

  const stream = fs.createReadStream(outputPath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed. Please process the recording again." });
    } else {
      res.end();
    }
  });
  stream.pipe(res);
}
