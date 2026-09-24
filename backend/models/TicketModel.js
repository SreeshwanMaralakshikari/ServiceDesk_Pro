import { Schema, model, Types } from 'mongoose'

// MVP ticket: core CRUD + lifecycle + simple (wall-clock) SLA due dates.
// The full business-hours SLA engine, approvals, watchers and linked
// tickets are scoped for a later phase — see PLAN.md Phase 3-5.

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
    enum: ['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED', 'CANCELLED'],
    default: 'OPEN',
  },

  assignedTo: { type: Types.ObjectId, ref: 'user' },
  assignedBy: { type: Types.ObjectId, ref: 'user' },
  assignedAt: { type: Date },

  comments:       [commentSchema],
  statusHistory:  [statusHistorySchema],

  sla: {
    responseDueAt:    { type: Date },
    resolutionDueAt:  { type: Date },
    firstRespondedAt: { type: Date },
    responseBreached:   { type: Boolean, default: false },
    resolutionBreached: { type: Boolean, default: false },
  },

  resolution: {
    summary:            { type: String },
    resolvedBy:         { type: Types.ObjectId, ref: 'user' },
    resolvedAt:         { type: Date },
    confirmedByRequester: { type: Boolean, default: false },
    confirmedAt:        { type: Date },
  },

  version:   { type: Number, default: 0 }, // optimistic concurrency guard
  isDeleted: { type: Boolean, default: false },
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
