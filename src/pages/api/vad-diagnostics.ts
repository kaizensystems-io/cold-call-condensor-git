import type { NextApiRequest, NextApiResponse } from "next";
import { checkSileroVadEnvironment } from "@/lib/ffmpeg";

type DiagnosticResponse = Awaited<ReturnType<typeof checkSileroVadEnvironment>> | { error: string };

export default async function handler(req: NextApiRequest, res: NextApiResponse<DiagnosticResponse>) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Use GET to check the local Silero VAD Python environment." });
    return;
  }

  try {
    const result = await checkSileroVadEnvironment();
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Could not inspect the local Python environment."
    });
  }
}
