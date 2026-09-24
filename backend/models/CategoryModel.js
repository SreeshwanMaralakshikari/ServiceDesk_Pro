import { Schema, model, Types } from 'mongoose'

const categorySchema = new Schema({
  name:             { type: String, required: [true, 'Name is required'] },
  description:      { type: String },
  department:       { type: Types.ObjectId, ref: 'department', required: [true, 'Handling team is required'] },
  ticketType:       { type: String, enum: ['INCIDENT', 'SERVICE_REQUEST'], default: 'INCIDENT' },
  defaultPriority:  { type: String, default: 'MEDIUM' },
  requiresApproval: { type: Boolean, default: false },
  isActive:         { type: Boolean, default: true },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

export const CategoryModel = model('category', categorySchema)
