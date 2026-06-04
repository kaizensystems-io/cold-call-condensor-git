"use client";

import { FormEvent, useMemo, useState } from "react";

type Segment = {
  index: number;
  start: number;
  end: number;
  duration: number;
};

type ProcessResult = {
  originalDuration: number;
  condensedDuration: number;
  removedDuration: number;
  segmentCount: number;
  outputFilename: string;
  segments: Segment[];
  warning?: string;
};

const allowedTypes = ".mp4,.mov,.mkv";

function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [silenceThreshold, setSilenceThreshold] = useState("-35");
  const [minimumSilenceDuration, setMinimumSilenceDuration] = useState("1.2");
  const [padding, setPadding] = useState("0.3");
  const [status, setStatus] = useState("Choose a recording to get started.");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const downloadUrl = useMemo(() => {
    return result ? `/api/download/${encodeURIComponent(result.outputFilename)}` : "";
  }, [result]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setResult(null);

    if (!file) {
      setError("Please choose an MP4, MOV, or MKV recording first.");
      return;
    }

    const formData = new FormData();
    formData.append("video", file);
    formData.append("silenceThreshold", silenceThreshold);
    formData.append("minimumSilenceDuration", minimumSilenceDuration);
    formData.append("padding", padding);

    setIsProcessing(true);
    setStatus("Uploading your recording...");

    try {
      setStatus("Detecting silence and building talking segments...");
      const response = await fetch("/api/process", {
        method: "POST",
        body: formData
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error ?? "Processing failed. Please try another recording.");
      }

      setResult(data);
      setStatus("Done. Your condensed recording is ready.");
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
      setStatus("Processing stopped.");
    } finally {
      setIsProcessing(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="intro">
        <p className="eyebrow">Local MVP</p>
        <h1>Cold Call Condenser</h1>
        <p className="description">Upload a long cold calling recording and remove the dead air.</p>
      </section>

      <form className="tool-panel" onSubmit={handleSubmit}>
        <label className="file-picker">
          <span>Recording</span>
          <input
            type="file"
            accept={allowedTypes}
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <small>{file ? file.name : "Accepted formats: MP4, MOV, MKV"}</small>
        </label>

        <div className="settings-grid">
          <label>
            <span>Silence threshold</span>
            <div className="input-row">
              <input
                type="number"
                value={silenceThreshold}
                onChange={(event) => setSilenceThreshold(event.target.value)}
                step="1"
              />
              <span>dB</span>
            </div>
          </label>

          <label>
            <span>Minimum silence</span>
            <div className="input-row">
              <input
                type="number"
                value={minimumSilenceDuration}
                onChange={(event) => setMinimumSilenceDuration(event.target.value)}
                min="0.1"
                step="0.1"
              />
              <span>sec</span>
            </div>
          </label>

          <label>
            <span>Speech padding</span>
            <div className="input-row">
              <input
                type="number"
                value={padding}
                onChange={(event) => setPadding(event.target.value)}
                min="0"
                step="0.1"
              />
              <span>sec</span>
            </div>
          </label>
        </div>

        <button className="primary-action" type="submit" disabled={isProcessing}>
          {isProcessing ? "Processing..." : "Upload and Condense"}
        </button>
      </form>

      <section className="status-panel" aria-live="polite">
        <strong>Status</strong>
        <p>{status}</p>
        {error ? <p className="error">{error}</p> : null}
        {result?.warning ? <p className="warning">{result.warning}</p> : null}
      </section>

      {result ? (
        <section className="results">
          <div className="summary-grid">
            <div>
              <span>Original duration</span>
              <strong>{formatDuration(result.originalDuration)}</strong>
            </div>
            <div>
              <span>Condensed duration</span>
              <strong>{formatDuration(result.condensedDuration)}</strong>
            </div>
            <div>
              <span>Time removed</span>
              <strong>{formatDuration(result.removedDuration)}</strong>
            </div>
            <div>
              <span>Talking segments</span>
              <strong>{result.segmentCount}</strong>
            </div>
          </div>

          <a className="download-button" href={downloadUrl}>
            Download processed MP4
          </a>

          <div className="segments">
            <h2>Detected Talking Segments</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Start</th>
                    <th>End</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {result.segments.map((segment) => (
                    <tr key={`${segment.index}-${segment.start}`}>
                      <td>{segment.index}</td>
                      <td>{formatDuration(segment.start)}</td>
                      <td>{formatDuration(segment.end)}</td>
                      <td>{formatDuration(segment.duration)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
