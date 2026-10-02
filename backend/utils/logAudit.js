import { AuditLogModel } from '../models/AuditLogModel.js'

// Writes one audit entry. Called AFTER the main write, and it never throws:
// a failed audit write is logged and the request still succeeds (same rule as
// notifications). `entity` is the document (or any object with _id/publicId).
export const logAudit = async ({ req, actor, action, entityType, entity, before, after }) => {
  try {
    await AuditLogModel.create({
      actor: actor ?? req?.user?.id,
      action,
      entityType,
      entityId: entity?._id,
      entityRef: entity?.publicId,
      before,
      after,
      ip: req?.ip,
    })
  } catch (err) {
    console.log('audit log write failed:', err.message)
  }
}
