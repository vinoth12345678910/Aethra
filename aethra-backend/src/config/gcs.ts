import { Storage } from "@google-cloud/storage";
import dotenv from "dotenv";

dotenv.config();

const bucketName = process.env.GCS_BUCKET_NAME!;
const storage = new Storage({
  keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
});

export const bucket = storage.bucket(bucketName);
export default storage;
