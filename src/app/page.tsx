"use client";

import { DragEvent, useMemo, useState } from "react";

type Clip = {
  index: number;
  start: number;
  end: number;
  duration: number;
  filename: string;
};

type ProcessResult = {
  originalDuration: number;
  condensedDuration: number;
  removedDuration: number;
  reductionPercentage: number;
  clipCount: number;
  outputFilename: string;
  clips: Clip[];
  warning?: string;
  detectionMethodUsed: "voice" | "basic";
};

const allowedTypes = ".mp4,.mov,.mkv";
function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "0m";
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }

  return `${secs}s`;
}

function formatTimestamp(seconds: number) {
  if (!Number.isFinite(seconds)) return "00:00";
  const totalSeconds = Math.max(0, Math.round(seconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

function isValidVideo(file: File) {
  return /\.(mp4|mov|mkv)$/i.test(file.name);
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M12 3v11m0 0 4-4m-4 4-4-4" />
      <path d="M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [detectionMethod, setDetectionMethod] = useState<"voice" | "basic">("voice");
  const [silenceThreshold, setSilenceThreshold] = useState("-40");
  const [minimumSilenceDuration, setMinimumSilenceDuration] = useState("5");
  const [padding, setPadding] = useState("2");
  const [mergeNearbyGap, setMergeNearbyGap] = useState("8");
  const [status, setStatus] = useState("Drop in a call recording to get started.");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [deletingClip, setDeletingClip] = useState("");

  const downloadUrl = useMemo(() => {
    return result ? `/api/download/${encodeURIComponent(result.outputFilename)}` : "";
  }, [result]);

  function chooseFile(nextFile: File | null) {
    setError("");
    setResult(null);
    setFeedback("");

    if (!nextFile) {
      setFile(null);
      setStatus("Drop in a call recording to get started.");
      return;
    }

    if (!isValidVideo(nextFile)) {
      setFile(null);
      setError("Please upload an MP4, MOV, or MKV recording.");
      setStatus("Choose a supported video file.");
      return;
    }

    setFile(nextFile);
    setStatus("Ready to condense this recording.");
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files?.[0] ?? null);
  }

  function saveFeedback(value: string) {
    setFeedback(value);
    const feedbackItem = {
      value,
      createdAt: new Date().toISOString(),
      outputFilename: result?.outputFilename ?? null,
      clipCount: result?.clipCount ?? null,
      reductionPercentage: result?.reductionPercentage ?? null
    };
    const existing = JSON.parse(localStorage.getItem("cold-call-condenser-feedback") ?? "[]");
    localStorage.setItem("cold-call-condenser-feedback", JSON.stringify([...existing, feedbackItem]));
  }

  async function deleteClip(clip: Clip) {
    setError("");
    setDeletingClip(clip.filename);

    try {
      const response = await fetch(`/api/download/${encodeURIComponent(clip.filename)}`, {
        method: "DELETE"
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error ?? "Could not delete this clip.");
      }

      setResult((currentResult) => {
        if (!currentResult) return currentResult;
        const nextClips = currentResult.clips.filter((currentClip) => currentClip.filename !== clip.filename);

        return {
          ...currentResult,
          clipCount: nextClips.length,
          clips: nextClips
        };
      });
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not delete this clip.");
    } finally {
      setDeletingClip("");
    }
  }

  function startProcessing() {
    setError("");
    setResult(null);
    setFeedback("");

    if (!file) {
      setError("Please choose an MP4, MOV, or MKV recording first.");
      return;
    }

    const formData = new FormData();
    formData.append("video", file);
    formData.append("detectionMethod", detectionMethod);
    formData.append("silenceThreshold", silenceThreshold);
    formData.append("minimumSilenceDuration", minimumSilenceDuration);
    formData.append("padding", padding);
    formData.append("mergeNearbyGap", mergeNearbyGap);

    setIsProcessing(true);
    setUploadProgress(0);
    setProcessingProgress(0);
    setStatus("Uploading your recording...");

    let stepTimer: ReturnType<typeof window.setInterval> | undefined;

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      setUploadProgress(progress);

      if (progress >= 100 && !stepTimer) {
        setStatus("Processing your recording...");
        setProcessingProgress(18);
        stepTimer = window.setInterval(() => {
          setProcessingProgress((currentProgress) => Math.min(94, currentProgress + 4));
        }, 2200);
      }
    };

    xhr.onload = () => {
      if (stepTimer) window.clearInterval(stepTimer);

      try {
        const data = JSON.parse(xhr.responseText);

        if (xhr.status < 200 || xhr.status >= 300) {
          throw new Error(data.error ?? "Processing failed. Please try another recording.");
        }

        setResult(data);
        setProcessingProgress(100);
        setStatus("Complete. Your clip-only video is ready.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
        setStatus("Processing stopped.");
      } finally {
        setIsProcessing(false);
      }
    };

    xhr.onerror = () => {
      if (stepTimer) window.clearInterval(stepTimer);
      setError("Upload failed. Please try again.");
      setStatus("Processing stopped.");
      setIsProcessing(false);
    };

    xhr.open("POST", "/api/process");
    xhr.send(formData);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Local-first video condenser</p>
        <h1>Cold Call Condenser</h1>
        <p className="description">
          Turn long call recordings into clean clip-only videos for cold callers and appointment setters.
          Keep the calls, lose the dialing, ringing, and dead air.
        </p>
      </section>

      <section className="workspace">
        <div className="upload-panel">
          <label
            className={`dropzone ${isDragging ? "is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <input
              type="file"
              accept={allowedTypes}
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
            />
            <span className="dropzone-title">{file ? file.name : "Drop your call recording here"}</span>
            <span className="dropzone-subtitle">or choose an MP4, MOV, or MKV file</span>
          </label>

          <div className="trust-strip" aria-label="Privacy promises">
            <span>✓ Processed locally</span>
            <span>✓ No cloud upload</span>
            <span>✓ Your recordings stay on your device</span>
          </div>

          <details className="advanced-settings">
            <summary>Advanced Settings</summary>
            <div className="settings-grid">
              <label>
                <span>Detection Method</span>
                <select
                  value={detectionMethod}
                  onChange={(event) => setDetectionMethod(event.target.value === "basic" ? "basic" : "voice")}
                >
                  <option value="voice">Voice Detection</option>
                  <option value="basic">Basic Silence Detection</option>
                </select>
              </label>

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

              <label>
                <span>Merge nearby speech gaps</span>
                <div className="input-row">
                  <input
                    type="number"
                    value={mergeNearbyGap}
                    onChange={(event) => setMergeNearbyGap(event.target.value)}
                    min="0"
                    step="0.5"
                  />
                  <span>sec</span>
                </div>
              </label>
            </div>

            <p className="settings-help">
              Voice Detection uses local Silero VAD to find human speech. Basic Silence Detection is the original
              FFmpeg fallback and may include typing, ringing, clicks, or background sounds.
            </p>
          </details>

          <button className="primary-action" type="button" disabled={isProcessing} onClick={startProcessing}>
            {isProcessing ? "Condensing..." : "Condense Recording"}
          </button>
        </div>

        <aside className="progress-panel" aria-live="polite">
          <div>
            <span className="panel-label">Status</span>
            <div className="status-title">
              {isProcessing ? <span className="spinner" aria-hidden="true" /> : null}
              <strong>{status}</strong>
            </div>
            <p>{isProcessing ? "Building clips and rendering video." : "Clip mode is tuned for cold calling sessions."}</p>
          </div>

          <div className="meter-group">
            <div className="meter-label">
              <span>Upload</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="meter">
              <span style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>

          <div className="meter-group">
            <div className="meter-label">
              <span>Processing</span>
              <span>{processingProgress}%</span>
            </div>
            <div className="meter">
              <span style={{ width: `${processingProgress}%` }} />
            </div>
          </div>

          {error ? <p className="error">{error}</p> : null}
          {result?.warning ? <p className="warning">{result.warning}</p> : null}
        </aside>
      </section>

      {!result ? (
        <section className="empty-state">
          <strong>No condensed video yet</strong>
          <p>Your success summary and clip previews will appear here after processing.</p>
        </section>
      ) : (
        <section className="results">
          <div className="success-header">
            <div>
              <span className="panel-label">Success</span>
              <h2>Clip-only video ready</h2>
            </div>
            <a className="download-button" href={downloadUrl}>
              Download full condensed video
            </a>
          </div>

          <div className="summary-grid">
            <div>
              <span>Original Duration</span>
              <strong>{formatDuration(result.originalDuration)}</strong>
            </div>
            <div>
              <span>Condensed Duration</span>
              <strong>{formatDuration(result.condensedDuration)}</strong>
            </div>
            <div>
              <span>Time Removed</span>
              <strong>{formatDuration(result.removedDuration)}</strong>
            </div>
            <div>
              <span>Clips Found</span>
              <strong>{result.clipCount}</strong>
            </div>
            <div>
              <span>Detection Used</span>
              <strong>{result.detectionMethodUsed === "voice" ? "Voice" : "Basic"}</strong>
            </div>
            <div>
              <span>Reduction</span>
              <strong>{result.reductionPercentage}%</strong>
            </div>
          </div>

          <div className="clip-section">
            <div className="section-heading">
              <h2>Clip Preview</h2>
              <p>Preview each clip, then download the full video or a single clip.</p>
            </div>

            <div className="clip-grid">
              {result.clips.map((clip) => (
                <article className="clip-card" key={clip.filename}>
                  <video
                    controls
                    preload="metadata"
                    src={`/api/download/${encodeURIComponent(clip.filename)}?preview=1`}
                  />
                  <div className="clip-card-body">
                    <div>
                      <h3>Clip #{clip.index}</h3>
                      <p>
                        Duration: {formatDuration(clip.duration)}
                        <br />
                        Started at: {formatTimestamp(clip.start)}
                      </p>
                    </div>
                    <div className="card-actions">
                      <a
                        className="icon-action"
                        href={`/api/download/${encodeURIComponent(clip.filename)}`}
                        aria-label={`Download clip ${clip.index}`}
                        title="Download clip"
                      >
                        <DownloadIcon />
                      </a>
                      <button
                        className="icon-action danger-action"
                        type="button"
                        aria-label={`Delete clip ${clip.index}`}
                        title="Delete clip"
                        disabled={deletingClip === clip.filename}
                        onClick={() => deleteClip(clip)}
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="feedback-panel">
            <div>
              <span className="panel-label">Beta feedback</span>
              <strong>Was this output useful?</strong>
            </div>
            <div className="feedback-actions">
              {["👍 Very Useful", "😐 Somewhat Useful", "👎 Not Useful"].map((value) => (
                <button
                  className={feedback === value ? "feedback-choice is-selected" : "feedback-choice"}
                  key={value}
                  type="button"
                  onClick={() => saveFeedback(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            {feedback ? <p>Saved locally. Thanks for helping tune the product.</p> : null}
          </div>
        </section>
      )}
    </main>
  );
}
