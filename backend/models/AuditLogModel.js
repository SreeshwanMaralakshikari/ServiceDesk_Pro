import { Schema, model, Types } from 'mongoose'

// append-only trail of who did what. Written through utils/logAudit.js; there
// are no update or delete routes, and the hooks below refuse changes made
// through the model as well.
const auditLogSchema = new Schema({
  actor:      { type: Types.ObjectId, ref: 'user' }, // empty for system actions
  action:     { type: String, required: true },      // e.g. TICKET_CLAIM, ASSET_ASSIGN, LOGIN
  entityType: { type: String, required: true },      // TICKET | ASSET | KB_ARTICLE | USER | WORK_LOG
  entityId:   { type: Types.ObjectId },
  entityRef:  { type: String },                      // readable id, e.g. TKT-2026-00004
  before:     { type: Schema.Types.Mixed },
  after:      { type: Schema.Types.Mixed },
  ip:         { type: String },
}, {
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
})

auditLogSchema.index({ entityType: 1, entityRef: 1, createdAt: -1 })
auditLogSchema.index({ actor: 1, createdAt: -1 })
auditLogSchema.index({ createdAt: -1 })

const refuse = function () {
  throw new Error('audit log entries are immutable')
}
auditLogSchema.pre('save', function () {
  if (!this.isNew) refuse()
})
for (const hook of ['updateOne', 'updateMany', 'findOneAndUpdate', 'findOneAndReplace', 'replaceOne', 'deleteOne', 'deleteMany', 'findOneAndDelete']) {
  auditLogSchema.pre(hook, refuse)
}

export const AuditLogModel = model('auditlog', auditLogSchema)
