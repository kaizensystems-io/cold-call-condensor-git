"use client";

import { DragEvent, useMemo, useState } from "react";

type Conversation = {
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
  conversationCount: number;
  outputFilename: string;
  conversations: Conversation[];
  warning?: string;
};

const allowedTypes = ".mp4,.mov,.mkv";
const processingSteps = [
  "Analyzing audio...",
  "Detecting silence...",
  "Building conversation blocks...",
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
  const [status, setStatus] = useState("Drop in an OBS recording to get started.");
  const [processingStep, setProcessingStep] = useState("");
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
      setStatus("Drop in an OBS recording to get started.");
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
      conversationCount: result?.conversationCount ?? null,
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
    setStatus("Uploading your recording...");

    let stepIndex = 0;
    let stepTimer: ReturnType<typeof window.setInterval> | undefined;

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
          setProcessingProgress(18 + stepIndex * 22);
        }, 1800);
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
        setProcessingProgress(100);
        setStatus("Complete. Your conversation-only video is ready.");
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : "Something went wrong.");
        setProcessingStep("");
        setStatus("Processing stopped.");
      } finally {
        setIsProcessing(false);
      }
    };

    xhr.onerror = () => {
      if (stepTimer) window.clearInterval(stepTimer);
      setError("Upload failed. Please try again.");
      setProcessingStep("");
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
          Turn long OBS cold call recordings into clean conversation-only videos. Keep the calls, lose the
          dialing, ringing, and dead air.
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
            <span className="dropzone-title">{file ? file.name : "Drop your OBS recording here"}</span>
            <span className="dropzone-subtitle">or choose an MP4, MOV, or MKV file</span>
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
            Higher minimum silence and merge gap values preserve full conversations by removing only meaningful
            dead air like dialing, ringing, and long pauses.
          </p>

          <button className="primary-action" type="button" disabled={isProcessing} onClick={startProcessing}>
            {isProcessing ? "Condensing..." : "Condense Recording"}
          </button>
        </div>

        <aside className="progress-panel" aria-live="polite">
          <div>
            <span className="panel-label">Status</span>
            <strong>{status}</strong>
            {processingStep ? <p>{processingStep}</p> : <p>Conversation mode is tuned for full call blocks.</p>}
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
          <p>Your success summary and conversation previews will appear here after processing.</p>
        </section>
      ) : (
        <section className="results">
          <div className="success-header">
            <div>
              <span className="panel-label">Success</span>
              <h2>Conversation-only video ready</h2>
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
              <span>Conversations Found</span>
              <strong>{result.conversationCount}</strong>
            </div>
            <div>
              <span>Reduction</span>
              <strong>{result.reductionPercentage}%</strong>
            </div>
          </div>

          <div className="conversation-section">
            <div className="section-heading">
              <h2>Conversation Preview</h2>
              <p>Preview each block, then download the full video or a single conversation clip.</p>
            </div>

            <div className="conversation-grid">
              {result.conversations.map((conversation) => (
                <article className="conversation-card" key={conversation.filename}>
                  <video
                    controls
                    preload="metadata"
                    src={`/api/download/${encodeURIComponent(conversation.filename)}?preview=1`}
                  />
                  <div className="conversation-card-body">
                    <div>
                      <h3>Conversation #{conversation.index}</h3>
                      <p>
                        Duration: {formatDuration(conversation.duration)}
                        <br />
                        Start: {formatTimestamp(conversation.start)}
                      </p>
                    </div>
                    <a className="secondary-action" href={`/api/download/${encodeURIComponent(conversation.filename)}`}>
                      Download
                    </a>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="feedback-panel">
            <div>
              <span className="panel-label">Beta feedback</span>
              <strong>How useful was this output?</strong>
            </div>
            <div className="feedback-actions">
              {["Very Useful", "Somewhat Useful", "Not Useful"].map((value) => (
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
