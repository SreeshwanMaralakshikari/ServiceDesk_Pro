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

  status: {
    type: String,
    enum: ['PENDING_APPROVAL', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'RESOLVED', 'CLOSED', 'REOPENED', 'REJECTED', 'CANCELLED'],
    default: 'OPEN',
  },

  assignedTo: { type: Types.ObjectId, ref: 'user' },
  assignedBy: { type: Types.ObjectId, ref: 'user' },
  assignedAt: { type: Date },

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
    responseDueAt:    { type: Date },
    resolutionDueAt:  { type: Date },
    firstRespondedAt: { type: Date },
    responseBreached:   { type: Boolean, default: false },
    resolutionBreached: { type: Boolean, default: false },
    pausedAt:           { type: Date },      // set while ON_HOLD
    totalPausedMs:      { type: Number, default: 0 },
  },

  resolution: {
    summary:            { type: String },
    resolvedBy:         { type: Types.ObjectId, ref: 'user' },
    resolvedAt:         { type: Date },
    confirmedByRequester: { type: Boolean, default: false },
    confirmedAt:        { type: Date },
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
ticketSchema.index({ title: 'text', description: 'text' })

export const TicketModel = model('ticket', ticketSchema)
