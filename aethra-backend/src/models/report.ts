import mongoose, { Schema, Document } from "mongoose";

export type ReportType = "audit" | "deepfake";

export interface IReport extends Document {
  type: ReportType;
  ownerUid: string;
  title?: string;
  description?: string;
  fileUrl?: string;
  metadata?: Record<string, any>;
  result: Record<string, any>;
  status: "pending" | "completed" | "failed";
  createdAt: Date;
  updatedAt: Date;
}

const ReportSchema: Schema = new Schema<IReport>(
  {
    type: { type: String, enum: ["audit", "deepfake"], required: true },
    ownerUid: { type: String, required: true, index: true },
    title: { type: String },
    description: { type: String },
    fileUrl: { type: String },
    metadata: { type: Schema.Types.Mixed, default: {} },
    result: { type: Schema.Types.Mixed, default: {} },
    status: { type: String, enum: ["pending", "completed", "failed"], default: "pending" },
  },
  { timestamps: true }
);

export const Report = mongoose.model<IReport>("Report", ReportSchema);
