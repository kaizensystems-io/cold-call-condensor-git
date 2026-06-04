import type { NextApiRequest, NextApiResponse } from "next";
import fs from "node:fs";
import { safeOutputPath } from "@/lib/storage";

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const filename = Array.isArray(req.query.filename) ? req.query.filename[0] : req.query.filename;

  if (!filename || !filename.endsWith(".mp4")) {
    res.status(400).json({ error: "Invalid download link." });
    return;
  }

  const outputPath = safeOutputPath(filename);

  if (!fs.existsSync(outputPath)) {
    res.status(404).json({ error: "The processed video could not be found. Please process the recording again." });
    return;
  }

  const stat = fs.statSync(outputPath);
  if (stat.size === 0) {
    res.status(500).json({ error: "The processed video is empty. Please process the recording again." });
    return;
  }

  res.setHeader("Content-Type", "video/mp4");
  res.setHeader("Content-Length", stat.size);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

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
