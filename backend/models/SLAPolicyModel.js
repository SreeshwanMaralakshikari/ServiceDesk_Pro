import { Schema, model } from 'mongoose'

const slaPolicySchema = new Schema({
  priority:            { type: String, required: [true, 'Priority code is required'], unique: true, uppercase: true },
  label:               { type: String, required: [true, 'Label is required'] },
  level:               { type: Number, required: [true, 'Level is required'] },
  color:               { type: String, default: '#6b7280' },
  responseTimeHours:   { type: Number, required: [true, 'Response time is required'] },
  resolutionTimeHours: { type: Number, required: [true, 'Resolution time is required'] },
  businessHoursOnly:   { type: Boolean, default: true }, // false = plain wall-clock (handy for demos/tests)
  isActive:            { type: Boolean, default: true },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

export const SLAPolicyModel = model('slapolicy', slaPolicySchema)
