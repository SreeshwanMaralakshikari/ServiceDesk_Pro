import { Schema, model, Types } from 'mongoose'

const departmentSchema = new Schema({
  name:     { type: String, required: [true, 'Name is required'], unique: true },
  code:     { type: String, required: [true, 'Code is required'], uppercase: true },
  kind:     { type: String, enum: ['BUSINESS', 'IT_SUPPORT'], required: [true, '{VALUE} is not a valid kind'] },
  manager:  { type: Types.ObjectId, ref: 'user' },
  isActive: { type: Boolean, default: true },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

export const DepartmentModel = model('department', departmentSchema)
