/**
 * worker-hf.js - final version
 * Usage: node worker-hf.js <REPORT_ID>
 *
 * Prereqs:
 *  - npm i axios form-data @google-cloud/storage dotenv
 *  - ffmpeg installed on PATH (for video frame extraction)
 *  - fill .env with proper values (GCS_KEYFILE relative/absolute path)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const FormData = require("form-data");
const { Storage } = require("@google-cloud/storage");
const { spawn } = require("child_process");

const API_BASE = process.env.API_BASE;
const SERVICE_KEY = process.env.SERVICE_KEY;
const GCS_KEYFILE = process.env.GCS_KEYFILE;
const GCS_BUCKET = process.env.GCS_BUCKET_NAME;
const TEMP_DIR = process.env.TEMP_DIR || "./tmp";
const HF_API_KEY = process.env.HF_API_KEY;

const HF_AUDIT_MODEL = process.env.HF_AUDIT_MODEL || "LLAVA-1.6-Mistral-7B";
const HF_FRAME_CLASSIFIER_MODEL = process.env.HF_FRAME_CLASSIFIER_MODEL || "prithivMLmods/deepfake-detector-model-v1";
const HF_REPORT_MODEL = process.env.HF_REPORT_MODEL || "Salesforce/blip2-opt-2.7b";

const FPS = Number(process.env.FRAMES_PER_SECOND || 1);
const MAX_FRAMES = Number(process.env.MAX_FRAMES || 8);

if (!API_BASE || !SERVICE_KEY || !GCS_KEYFILE || !GCS_BUCKET || !HF_API_KEY) {
  console.error("Missing required env vars. See .env.example");
  process.exit(1);
}

const storage = new Storage({ keyFilename: GCS_KEYFILE });

// ---- small retry helper ----
async function retry(fn, attempts = 3, baseDelay = 500) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      const delay = baseDelay * Math.pow(2, i);
      await new Promise(res => setTimeout(res, delay));
    }
  }
  throw lastErr;
}

// ---- backend helpers ----
async function getReport(reportId) {
  const url = `${API_BASE}/reports/${reportId}`;
  return retry(() => axios.get(url, { headers: { Authorization: `Bearer ${SERVICE_KEY}` }, timeout: 30000 })
    .then(r => r.data));
}

async function patchReport(reportId, result, status = "completed") {
  const url = `${API_BASE}/reports/${reportId}`;
  return retry(() => axios.patch(url, { result, status }, { headers: { Authorization: `Bearer ${SERVICE_KEY}` }, timeout: 30000 })
    .then(r => r.data));
}

// ---- GCS helpers ----
async function downloadFromGCS(gsUri) {
  const m = gsUri.match(/^gs:\/\/([^/]+)\/(.+)$/);
  if (!m) throw new Error("Invalid gs uri: " + gsUri);
  const bucketName = m[1], objectName = m[2];
  await fs.promises.mkdir(TEMP_DIR, { recursive: true });
  const dest = path.join(TEMP_DIR, `${Date.now()}-${path.basename(objectName)}`);
  await retry(() => storage.bucket(bucketName).file(objectName).download({ destination: dest }));
  return dest;
}

async function uploadToGCS(localPath, destName) {
  const destPath = destName || `diagnostics/${path.basename(localPath)}`;
  await retry(() => storage.bucket(GCS_BUCKET).upload(localPath, { destination: destPath }));
  return `gs://${GCS_BUCKET}/${destPath}`;
}

// ---- ffmpeg frame extraction ----
function extractFrames(videoPath, outDir, fps = 1) {
  return new Promise((resolve, reject) => {
    fs.promises.mkdir(outDir, { recursive: true }).then(() => {
      const args = ["-y", "-i", videoPath, "-vf", `fps=${fps}`, path.join(outDir, "frame-%06d.jpg")];
      const ff = spawn("ffmpeg", args);
      ff.stderr.on("data", () => {}); // ignore logs
      ff.on("close", async (code) => {
        if (code !== 0) return reject(new Error("ffmpeg failed with code " + code));
        try {
          const files = await fs.promises.readdir(outDir);
          const frames = files.filter(f => f.endsWith(".jpg") || f.endsWith(".png")).map(f => path.join(outDir, f));
          resolve(frames);
        } catch (e) { reject(e); }
      });
    }).catch(reject);
  });
}

// ---- HF API wrappers ----
async function callHFTextModel(prompt, model = HF_AUDIT_MODEL) {
  const url = `https://api-inference.huggingface.co/models/${model}`;
  const headers = { Authorization: `Bearer ${HF_API_KEY}`, "Content-Type": "application/json" };
  const payload = { inputs: prompt, options: { wait_for_model: true } };
  const res = await retry(() => axios.post(url, payload, { headers, timeout: 120000 }));
  const data = res.data;
  if (typeof data === "string") return data;
  if (Array.isArray(data) && data[0] && (data[0].generated_text || data[0].text)) return data[0].generated_text || data[0].text;
  return JSON.stringify(data);
}

async function callHFFrameClassifier(framePath, model = HF_FRAME_CLASSIFIER_MODEL) {
  const url = `https://api-inference.huggingface.co/models/${model}`;
  const form = new FormData();
  form.append("image", fs.createReadStream(framePath));
  const headers = Object.assign({ Authorization: `Bearer ${HF_API_KEY}` }, form.getHeaders());
  const res = await retry(() => axios.post(url, form, { headers, timeout: 120000 }));
  return res.data;
}

async function callHFReportModel(promptText, imagePaths = [], model = HF_REPORT_MODEL) {
  // Try multimodal form-data first (if model supports images)
  const url = `https://api-inference.huggingface.co/models/${model}`;
  try {
    const form = new FormData();
    form.append("inputs", JSON.stringify({ text: promptText }));
    imagePaths.slice(0, 3).forEach((p, i) => form.append(`image_${i}`, fs.createReadStream(p)));
    const headers = Object.assign({ Authorization: `Bearer ${HF_API_KEY}` }, form.getHeaders());
    const res = await retry(() => axios.post(url, form, { headers, timeout: 180000 }));
    const data = res.data;
    if (typeof data === "string") return data;
    if (Array.isArray(data) && data[0] && (data[0].generated_text || data[0].text)) return data[0].generated_text || data[0].text;
    return data;
  } catch (err) {
    // fallback to text-only
    const fallbackPrompt = [
      "You are an expert forensic analyst. Using the evidence below (labels & confidences), produce JSON: summary, type='deepfake', verdict('likely_fake'|'likely_real'|'inconclusive'), confidence(0-100), evidence[], recommendations[].",
      "",
      promptText
    ].join("\n\n");
    return callHFTextModel(fallbackPrompt, HF_AUDIT_MODEL);
  }
}

// ---- aggregation ----
function aggregateFrameResults(frameResults) {
  let fakeVotes = 0;
  let total = frameResults.length || 1;
  let confidences = [];
  for (const fr of frameResults) {
    if (!fr) continue;
    // classifier array common shape
    if (fr.classifier && Array.isArray(fr.classifier)) {
      const best = fr.classifier[0];
      if (best && best.label) {
        const lab = best.label.toString().toLowerCase();
        if (lab.includes("fake") || lab.includes("synthetic") || lab.includes("manipul")) fakeVotes++;
        if (best.score) confidences.push(Math.round(best.score * 100));
        continue;
      }
    }
    // text fallback
    if (typeof fr === "string") {
      const t = fr.toLowerCase();
      if (t.includes("fake") || t.includes("synthetic") || t.includes("manipul")) fakeVotes++;
      const m = t.match(/confidence[:=]\s*(\d{1,3})/);
      if (m) confidences.push(Number(m[1]));
      continue;
    }
    // fallback parse
    try {
      const txt = JSON.stringify(fr).toLowerCase();
      if (txt.includes("fake") || txt.includes("synthetic") || txt.includes("manipul")) fakeVotes++;
    } catch (e) {}
  }
  const ratio = fakeVotes / total;
  const avgConf = confidences.length ? Math.round(confidences.reduce((a,b)=>a+b,0)/confidences.length) : null;
  const verdict = ratio > 0.4 ? "likely_fake" : ratio < 0.1 ? "likely_real" : "inconclusive";
  const confidence = avgConf || Math.round(Math.min(100, Math.max(40, ratio * 100 + 40)));
  return { verdict, confidence, ratio, fakeVotes, total, avgConf };
}

// ---- analysis functions ----
async function analyzeDeepfake(report, runId, toCleanup) {
  if (!report.fileUrl) throw new Error("report.fileUrl missing");
  const localVideo = await downloadFromGCS(report.fileUrl);
  toCleanup.push(localVideo);
  const framesDir = path.join(TEMP_DIR, `frames-${runId}`);
  const frames = await extractFrames(localVideo, framesDir, FPS);
  toCleanup.push(framesDir);
  if (!frames.length) throw new Error("No frames extracted");

  const sample = frames.slice(0, MAX_FRAMES);
  const frameResults = [];
  for (const f of sample) {
    try {
      const clfRaw = await callHFFrameClassifier(f);
      frameResults.push({ frame: path.basename(f), classifier: clfRaw });
    } catch (err) {
      frameResults.push({ frame: path.basename(f), error: (err && err.message) || "classifier error" });
    }
  }

  const agg = aggregateFrameResults(frameResults);
  const sampleSummaries = frameResults.map(fr => {
    if (fr.error) return `${fr.frame}: ERROR(${fr.error})`;
    if (fr.classifier && Array.isArray(fr.classifier)) {
      const best = fr.classifier[0];
      const label = best ? (best.label || JSON.stringify(best)) : JSON.stringify(fr.classifier);
      const score = best && best.score ? `score=${Math.round(best.score*100)}` : "";
      return `${fr.frame}: ${label} ${score}`;
    }
    return `${fr.frame}: ${JSON.stringify(fr).slice(0,200)}`;
  });

  const reportPromptText = [
    "You are an expert forensic analyst. Using the evidence below (frame classifier labels and confidences), produce JSON with fields: summary, type='deepfake', verdict(one of 'likely_fake','likely_real','inconclusive'), confidence(0-100), evidence[], recommendations[].",
    "",
    "AGGREGATED STATS:",
    JSON.stringify(agg, null, 2),
    "",
    "SAMPLE FRAME RESULTS (frame: label [score]):",
    sampleSummaries.join("\n"),
    "",
    "Make evidence[] an array of short strings citing frame filenames and reasons. Keep JSON valid. If unsure, set verdict to 'inconclusive'."
  ].join("\n\n");

  let rawReport;
  try {
    const exampleImages = sample.slice(0, 3);
    rawReport = await callHFReportModel(reportPromptText, exampleImages, HF_REPORT_MODEL);
  } catch (err) {
    rawReport = await callHFTextModel(reportPromptText, HF_AUDIT_MODEL);
  }

  let parsedReport;
  try {
    if (typeof rawReport === "object") parsedReport = rawReport;
    else parsedReport = JSON.parse(typeof rawReport === "string" ? rawReport : JSON.stringify(rawReport));
  } catch (err) {
    const textSummary = (typeof rawReport === "string") ? rawReport : JSON.stringify(rawReport);
    parsedReport = {
      summary: textSummary.toString().slice(0, 1000),
      type: "deepfake",
      verdict: agg.verdict,
      confidence: agg.confidence,
      evidence: sampleSummaries.slice(0, 6),
      recommendations: []
    };
  }

  const diagLocal = path.join(TEMP_DIR, `diag-deepfake-${runId}.json`);
  const diag = { sampledFrames: sample.map(p => path.basename(p)), frameResults, aggregator: agg, parsedReport };
  await fs.promises.writeFile(diagLocal, JSON.stringify(diag, null, 2));
  toCleanup.push(diagLocal);
  const artifactUri = await uploadToGCS(diagLocal, `diagnostics/deepfake-${runId}.json`);

  const result = {
    summary: parsedReport.summary || `Deepfake analysis: ${agg.verdict} (conf ${agg.confidence})`,
    type: "deepfake",
    verdict: parsedReport.verdict || agg.verdict,
    confidence: parsedReport.confidence || agg.confidence,
    traces: {
      temporal_inconsistency: agg.ratio,
      facial_artifact_score: agg.ratio,
      metadata_mismatch_score: 0
    },
    frame_annotations: frameResults.slice(0, 3).map(fr => {
      let reason = fr.error ? `error: ${fr.error}` : (fr.classifier && fr.classifier[0] ? `${fr.classifier[0].label} (${Math.round((fr.classifier[0].score||0)*100)}%)` : JSON.stringify(fr).slice(0,200));
      return { frame: fr.frame, reason, heatmap: null };
    }),
    notes: `sampled=${sample.length}, frameClassifier=${HF_FRAME_CLASSIFIER_MODEL}, reportModel=${HF_REPORT_MODEL}`,
    artifacts: { diagnostic: artifactUri },
    raw: { parsedReport }
  };

  return result;
}

async function analyzeAudit(report, runId, toCleanup) {
  const metadata = report.metadata || {};
  const prompt = [
    "You are an ethics auditor. Given the model metadata below produce JSON with fields: summary,type='audit',scores{transparency,fairness,privacy,robustness},metrics,flagged_issues[],recommendations[]. Output JSON only.",
    "MODEL METADATA:",
    JSON.stringify(metadata, null, 2)
  ].join("\n\n");

  const raw = await callHFTextModel(prompt, HF_AUDIT_MODEL);
  let parsed;
  try { parsed = JSON.parse(raw); } catch (err) {
    parsed = {
      summary: raw.toString().slice(0, 1000),
      type: "audit",
      scores: { transparency: 60, fairness: 50, privacy: 60, robustness: 55 },
      metrics: {}, flagged_issues: [], recommendations: []
    };
  }

  const rawLocal = path.join(TEMP_DIR, `audit-raw-${runId}.txt`);
  await fs.promises.mkdir(TEMP_DIR, { recursive: true });
  await fs.promises.writeFile(rawLocal, raw);
  toCleanup.push(rawLocal);
  const art = await uploadToGCS(rawLocal, `diagnostics/audit-raw-${runId}.txt`);
  parsed.artifacts = parsed.artifacts || {};
  parsed.artifacts.raw_output = art;
  return parsed;
}

// ---- main runner ----
async function run(reportId) {
  console.log("Worker processing report:", reportId);
  const report = await getReport(reportId);
  if (!report) throw new Error("Report not found: " + reportId);
  if (report.status === "completed") {
    console.log("Report already completed; skipping:", reportId);
    return;
  }
  const runId = `${reportId}-${Date.now()}`;
  const toCleanup = [];

  try {
    let result;
    if (report.type === "deepfake") result = await analyzeDeepfake(report, runId, toCleanup);
    else if (report.type === "audit") result = await analyzeAudit(report, runId, toCleanup);
    else throw new Error("Unknown report type: " + report.type);

    await patchReport(reportId, result, "completed");
    console.log("Updated report", reportId, "status=completed");
  } catch (err) {
    console.error("Worker error:", (err && err.message) || err);
    try {
      await patchReport(reportId, { summary: "worker failed", notes: (err && err.message) || String(err) }, "failed");
    } catch (e) { console.error("Failed to patch failed:", e); }
  } finally {
    // cleanup local artifacts
    await Promise.all(toCleanup.map(p => fs.promises.rm(p, { recursive: true, force: true }).catch(()=>{})));
  }
}

// CLI entry
const id = process.argv[2];
if (!id) { console.error("Usage: node worker-hf.js <reportId>"); process.exit(1); }
run(id).catch(e => { console.error(e); process.exit(1); });
