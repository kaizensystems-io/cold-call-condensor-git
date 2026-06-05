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
};

const allowedTypes = ".mp4,.mov,.mkv";
const processingSteps = [
  "Analyzing audio...",
  "Detecting speech...",
  "Merging audio clips...",
  "Rendering final video..."
];

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

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [silenceThreshold, setSilenceThreshold] = useState("-40");
  const [minimumSilenceDuration, setMinimumSilenceDuration] = useState("5");
  const [padding, setPadding] = useState("2");
  const [mergeNearbyGap, setMergeNearbyGap] = useState("8");
  const [status, setStatus] = useState("Drop in a call recording to get started.");
  const [processingStep, setProcessingStep] = useState("");
  const [renderingHint, setRenderingHint] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProcessResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [feedback, setFeedback] = useState("");

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
    formData.append("silenceThreshold", silenceThreshold);
    formData.append("minimumSilenceDuration", minimumSilenceDuration);
    formData.append("padding", padding);
    formData.append("mergeNearbyGap", mergeNearbyGap);

    setIsProcessing(true);
    setUploadProgress(0);
    setProcessingProgress(0);
    setProcessingStep("Preparing upload...");
    setRenderingHint("");
    setStatus("Uploading your recording...");

    let stepIndex = 0;
    let renderHintIndex = 0;
    let stepTimer: ReturnType<typeof window.setInterval> | undefined;
    const renderHints = [
      "Still working — large files can take a few minutes.",
      "Do not close this tab.",
      "Rendering final video..."
    ];

    const xhr = new XMLHttpRequest();

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const progress = Math.round((event.loaded / event.total) * 100);
      setUploadProgress(progress);

      if (progress >= 100 && !stepTimer) {
        setStatus("Processing your recording...");
        setProcessingStep(processingSteps[0]);
        setProcessingProgress(18);
        stepTimer = window.setInterval(() => {
          stepIndex = Math.min(stepIndex + 1, processingSteps.length - 1);
          setProcessingStep(processingSteps[stepIndex]);
          setProcessingProgress((currentProgress) => Math.min(94, Math.max(currentProgress + 6, 18 + stepIndex * 18)));

          if (processingSteps[stepIndex] === "Rendering final video...") {
            setRenderingHint(renderHints[renderHintIndex % renderHints.length]);
            renderHintIndex += 1;
          } else {
            setRenderingHint("");
          }
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
        setProcessingStep("Complete.");
        setRenderingHint("");
        setProcessingProgress(100);
        setStatus("Complete. Your clip-only video is ready.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
        setProcessingStep("");
        setRenderingHint("");
        setStatus("Processing stopped.");
      } finally {
        setIsProcessing(false);
      }
    };

    xhr.onerror = () => {
      if (stepTimer) window.clearInterval(stepTimer);
      setError("Upload failed. Please try again.");
      setProcessingStep("");
      setRenderingHint("");
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
              Higher minimum silence and merge gap values preserve larger clips by removing only meaningful
              dead air like dialing, ringing, and long pauses.
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
            {processingStep ? <p>{processingStep}</p> : <p>Clip mode is tuned for cold calling sessions.</p>}
            {renderingHint ? <p className="rendering-hint">{renderingHint}</p> : null}
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
                        className="secondary-action"
                        href={`/api/download/${encodeURIComponent(clip.filename)}?preview=1`}
                      >
                        Preview
                      </a>
                      <a className="secondary-action" href={`/api/download/${encodeURIComponent(clip.filename)}`}>
                        Download Clip
                      </a>
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
