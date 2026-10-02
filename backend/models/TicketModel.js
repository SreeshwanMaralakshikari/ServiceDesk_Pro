import { Schema, model, Types } from 'mongoose'

// Phase 2: approvals + the full Section 6b status matrix (minus linked
// tickets/watchers, which stay in Phase 6, and business-hours SLA math,
// which is Phase 3 — ON_HOLD here just pauses on wall-clock time for now).

const commentSchema = new Schema({
  author:     { type: Types.ObjectId, ref: 'user', required: true },
  text:       { type: String, required: [true, 'Comment text is required'] },
  isInternal: { type: Boolean, default: false },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

const statusHistorySchema = new Schema({
  from: { type: String },
  to:   { type: String, required: true },
  by:   { type: Types.ObjectId, ref: 'user' },
  note: { type: String },
  at:   { type: Date, default: Date.now },
}, { _id: false, strict: 'throw' })

const ticketSchema = new Schema({
  publicId:    { type: String, unique: true },
  title:       { type: String, required: [true, 'Title is required'] },
  description: { type: String, required: [true, 'Description is required'] },
  type:        { type: String, enum: ['INCIDENT', 'SERVICE_REQUEST'], default: 'INCIDENT' },

  requester:           { type: Types.ObjectId, ref: 'user', required: true },
  requesterDepartment: { type: Types.ObjectId, ref: 'department' },
  department:          { type: Types.ObjectId, ref: 'department', required: true }, // handling IT team
  category:            { type: Types.ObjectId, ref: 'category', required: true },
  priority:            { type: String, default: 'MEDIUM' },
  relatedAsset:        { type: Types.ObjectId, ref: 'asset' }, // optional — the asset this ticket is about

  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED', 'REJECTED', 'CANCELLED'],
    default: 'OPEN',
  },

  assignedTo: { type: Types.ObjectId, ref: 'user' },
  assignedBy: { type: Types.ObjectId, ref: 'user' },
  assignedAt: { type: Date },
  assignmentMethod: { type: String, enum: ['MANUAL', 'CLAIM', 'AUTO'] }, // how the current assignee got the ticket

  approval: {
    approvedBy: { type: Types.ObjectId, ref: 'user' },
    approvedAt: { type: Date },
    rejectedBy: { type: Types.ObjectId, ref: 'user' },
    rejectedAt: { type: Date },
    rejectionReason: { type: String },
  },

  cancellation: {
    cancelledBy: { type: Types.ObjectId, ref: 'user' },
    cancelledAt: { type: Date },
    reason: { type: String },
  },

  comments:       [commentSchema],
  statusHistory:  [statusHistorySchema],

  sla: {
    policy:           { type: Types.ObjectId, ref: 'slapolicy' },
    startedAt:        { type: Date },  // start of the *current* cycle — reset on reopen
    responseDueAt:    { type: Date },
    resolutionDueAt:  { type: Date },
    firstRespondedAt: { type: Date },
    responseBreached:   { type: Boolean, default: false },
    resolutionBreached: { type: Boolean, default: false },
    warnAt:             { type: Date },              // 75% point of the resolution window
    warningSent:        { type: Boolean, default: false },
    escalationLevel:    { type: Number, default: 0 }, // 0=none, 1=response breach, 2=resolution breach
    pastBreaches:       { type: Number, default: 0 }, // resolution breaches from earlier reopen cycles
    pausedAt:           { type: Date },      // set while ON_HOLD
    totalPausedMs:      { type: Number, default: 0 }, // business-time ms for the current cycle
  },

  resolution: {
    summary:            { type: String },
    resolvedBy:         { type: Types.ObjectId, ref: 'user' },
    resolvedAt:         { type: Date },
    confirmedByRequester: { type: Boolean, default: false },
    confirmedAt:        { type: Date },
  },

  // how and when the ticket was closed. Cleared again on reopen. DUPLICATE and
  // AUTO_CLOSED are reserved for the duplicate-linking / auto-close features
  closeReason: { type: String, enum: ['CONFIRMED', 'DUPLICATE', 'AUTO_CLOSED'] },
  closedAt:    { type: Date },

  // requester satisfaction, only for CLOSED + CONFIRMED. A rating after a
  // reopen and re-close overwrites the old one (dashboards use the latest)
  csat: {
    rating:      { type: Number, min: 1, max: 5 },
    comment:     { type: String, maxlength: 500 },
    submittedAt: { type: Date },
  },

  // what the AI said about this ticket. `acceptedByUser` is worked out by the server
  // from the classify log the create form points at, never taken from the client.
  // kbSuggestions caches the technician-side article suggestions (D5) until someone refreshes.
  ai: {
    source:            { type: String, enum: ['ai', 'fallback'] },
    aiLogId:           { type: Types.ObjectId, ref: 'ailog' },
    suggestedCategory: { type: Types.ObjectId, ref: 'category' },
    suggestedPriority: { type: String },
    probableIssue:     { type: String, maxlength: 300 },
    acceptedByUser:    { type: Boolean },
    kbSuggestions: {
      at:        { type: Date },
      source:    { type: String, enum: ['ai'] },
      matchedBy: { type: String },
      items: [{
        _id: false,
        publicId:  { type: String },
        relevance: { type: Number, min: 0, max: 100 },
        why:       { type: String, maxlength: 300 },
        steps:     [{ type: String, maxlength: 300 }],
      }],
    },
  },

  reopenCount: { type: Number, default: 0 },
  version:     { type: Number, default: 0 }, // optimistic concurrency guard
  isDeleted:   { type: Boolean, default: false },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

ticketSchema.index({ status: 1, department: 1, priority: 1 })
ticketSchema.index({ assignedTo: 1, status: 1 })
ticketSchema.index({ requester: 1 })
ticketSchema.index({ status: 1, 'sla.resolutionDueAt': 1 }) // for the SLA checker's query
ticketSchema.index({ title: 'text', description: 'text' })

export const TicketModel = model('ticket', ticketSchema)
