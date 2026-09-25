import { Schema, model, Types } from 'mongoose'

const notificationSchema = new Schema({
  user:    { type: Types.ObjectId, ref: 'user', required: true },
  type:    {
    type: String,
    enum: ['TICKET_CREATED', 'TICKET_ASSIGNED', 'STATUS_CHANGED', 'COMMENT_ADDED', 'TICKET_REOPENED', 'TICKET_CLOSED', 'APPROVAL_REQUESTED', 'TICKET_APPROVED', 'TICKET_REJECTED', 'TICKET_ON_HOLD', 'GENERAL'],
    required: true,
  },
  message: { type: String, required: true },
  link:    { type: String },
  isRead:  { type: Boolean, default: false },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

export const NotificationModel = model('notification', notificationSchema)
