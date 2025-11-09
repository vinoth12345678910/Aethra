import { ReportType } from "../models/report";

export function generateMockResult(type: ReportType) {
  if (type === "audit") {
    return {
      summary: "Mock ethics audit generated.",
      scores: {
        transparency: Math.round(60 + Math.random() * 40),
        fairness: Math.round(50 + Math.random() * 50),
        privacy: Math.round(40 + Math.random() * 60),
        robustness: Math.round(30 + Math.random() * 70)
      },
      details: {
        model_card_present: Math.random() > 0.5,
        licensing_check: Math.random() > 0.4,
        dataset_bias_notes: "Mock note — replace with LLM-driven analysis"
      },
      flagged_issues: []
    };
  } else {
    return {
      summary: "Mock deepfake analysis.",
      verdict: Math.random() > 0.5 ? "likely_real" : "likely_fake",
      confidence: Math.round(60 + Math.random() * 40),
      traces: {
        metadata_mismatch_score: Math.round(Math.random() * 100),
        visual_artifact_score: Math.round(Math.random() * 100)
      },
      notes: "Mock analysis for demo; integrate real detector later"
    };
  }
}
