import mongoose, { Schema, Document } from 'mongoose';

export interface ILegalRawDocument extends Document {
  documentId: string;
  versionNumber: number;
  title: string;
  sourceUrl: string;
  contentHash: string;
  mimeType: string;
  fileSize?: number;
  rawText: string;
  rawBinaryBase64?: string;
  pageTexts?: Array<{ pageNumber: number; text: string }>;
  ocrUsed?: boolean;
  ocrConfidence?: number;
  extractedStructure?: Record<string, any>;
  metadata?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const LegalRawDocumentSchema = new Schema<ILegalRawDocument>(
  {
    documentId: { type: String, required: true, index: true },
    versionNumber: { type: Number, required: true, default: 1 },
    title: { type: String, required: true },
    sourceUrl: { type: String, required: true },
    contentHash: { type: String, required: true, index: true },
    mimeType: { type: String, default: 'text/plain' },
    fileSize: { type: Number },
    rawText: { type: String, required: true },
    rawBinaryBase64: { type: String },
    pageTexts: { type: Schema.Types.Mixed },
    ocrUsed: { type: Boolean, default: false },
    ocrConfidence: { type: Number },
    extractedStructure: { type: Schema.Types.Mixed },
    metadata: { type: Schema.Types.Mixed },
  },
  {
    timestamps: true,
    collection: 'legal_raw_documents',
  }
);

LegalRawDocumentSchema.index({ documentId: 1, versionNumber: 1 }, { unique: true });

export const LegalRawDocument =
  mongoose.models.LegalRawDocument ||
  mongoose.model<ILegalRawDocument>('LegalRawDocument', LegalRawDocumentSchema);

export default LegalRawDocument;
