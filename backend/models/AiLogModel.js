import { Schema, model, Types } from 'mongoose'

// One record per AI-feature call. Kept deliberately small: a short input
// SNIPPET for debugging context (never the full ticket text), and the
// parsed/validated OUTPUT actually returned to the client (never the raw
// model response), so this collection stays cheap to keep and safe to read.
const aiLogSchema = new Schema({
  kind: {
    type: String,
    enum: ['CLASSIFY_TICKET', 'KB_SUGGESTIONS', 'KB_RERANK'],
    required: [true, 'Kind is required'],
  },
  // SUCCESS: the AI call was used and its response validated.
  // FALLBACK: no API key configured — the offline heuristic answered instead
  // (expected/normal, not an error).
  // ERROR: a key was configured but the call, parse, or validation failed,
  // and the heuristic stepped in as a safety net — worth flagging
  // differently from FALLBACK since it means something needs attention.
  status: {
    type: String,
    enum: ['SUCCESS', 'FALLBACK', 'ERROR'],
    required: [true, 'Status is required'],
  },
  requestedBy: { type: Types.ObjectId, ref: 'user', required: true },
  ticket:      { type: Types.ObjectId, ref: 'ticket' }, // absent for classify-ticket — it runs pre-creation, before a ticket exists
  provider:    { type: String, default: 'groq' },
  model:       { type: String },
  latencyMs:   { type: Number },
  inputSnippet: { type: String, maxlength: 200 },
  inputHash:    { type: String, maxlength: 64 }, // sha256 of the normalised input: identical questions reuse an earlier answer
  cached:       { type: Boolean, default: false }, // true when the answer came from an earlier call, not the model
  output:       { type: Schema.Types.Mixed },
  errorMessage: { type: String, maxlength: 300 },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

aiLogSchema.index({ kind: 1, createdAt: -1 })
aiLogSchema.index({ kind: 1, inputHash: 1, status: 1, createdAt: -1 })

export const AiLogModel = model('ailog', aiLogSchema)
