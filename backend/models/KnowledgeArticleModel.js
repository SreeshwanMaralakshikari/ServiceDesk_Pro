import { Schema, model, Types } from 'mongoose'

// same shape as Asset's lifecycleHistory / Ticket's statusHistory — one
// audit-trail pattern reused across every workflow-driven model
const kbHistoryEntrySchema = new Schema({
  fromStatus: { type: String },
  toStatus:   { type: String, required: true },
  by:         { type: Types.ObjectId, ref: 'user' },
  note:       { type: String, maxlength: [500, 'Note must be 500 characters or fewer'] },
  at:         { type: Date, default: Date.now },
}, { _id: false, strict: 'throw' })

const knowledgeArticleSchema = new Schema({
  publicId: { type: String, unique: true },
  // trim runs before `required`, so a whitespace-only value counts as missing
  title:    { type: String, trim: true, required: [true, 'Title is required'], maxlength: [200, 'Title must be 200 characters or fewer'] },
  summary:  { type: String, trim: true, required: [true, 'Summary is required'], maxlength: [500, 'Summary must be 500 characters or fewer'] },
  content:  { type: String, trim: true, required: [true, 'Content is required'], maxlength: [50000, 'Content must be 50,000 characters or fewer'] },
  category: { type: Types.ObjectId, ref: 'category', required: [true, 'Category is required'] },
  tags: {
    type: [{ type: String, lowercase: true, trim: true, maxlength: [30, 'Each tag must be 30 characters or fewer'] }],
    validate: { validator: (v) => v.length <= 10, message: 'At most 10 tags per article' },
  },

  status: {
    type: String,
    enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'],
    default: 'DRAFT',
  },

  author: { type: Types.ObjectId, ref: 'user', required: true },

  viewCount:   { type: Number, default: 0 }, // published views only, bumped atomically in the route
  publishedAt: { type: Date },
  archivedAt:  { type: Date },

  history: [kbHistoryEntrySchema],

  version:   { type: Number, default: 0 }, // optimistic concurrency guard on publish/archive/restore, same pattern as Ticket/Asset
  isDeleted: { type: Boolean, default: false },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

knowledgeArticleSchema.index({ status: 1, category: 1 })
knowledgeArticleSchema.index({ author: 1 })
knowledgeArticleSchema.index({ title: 'text', summary: 'text', content: 'text', tags: 'text' })

export const KnowledgeArticleModel = model('knowledgearticle', knowledgeArticleSchema)
