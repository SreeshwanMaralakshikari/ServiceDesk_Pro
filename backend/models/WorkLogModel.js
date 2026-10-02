import { Schema, model, Types } from 'mongoose'

// time a technician spent on a ticket. A separate collection (not an array on
// the ticket) so it can grow without bloating every ticket read.
const workLogSchema = new Schema({
  ticket:       { type: Types.ObjectId, ref: 'ticket', required: true },
  technician:   { type: Types.ObjectId, ref: 'user', required: true },
  description:  { type: String, required: [true, 'Description is required'], trim: true, maxlength: 1000 },
  minutesSpent: { type: Number, required: [true, 'Minutes spent is required'], min: 1, max: 1440, validate: { validator: Number.isInteger, message: 'Minutes must be a whole number' } },
}, {
  versionKey: false,
  timestamps: { createdAt: true, updatedAt: false },
  strict: 'throw',
})

workLogSchema.index({ ticket: 1, createdAt: -1 })

export const WorkLogModel = model('worklog', workLogSchema)
