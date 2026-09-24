import { Schema, model, Types } from 'mongoose'

const userSchema = new Schema({
  firstName:   { type: String, required: [true, 'First name is required'] },
  lastName:    { type: String },
  email:       { type: String, required: [true, 'Email is required'], unique: [true, 'Email already exists'], lowercase: true, trim: true },
  password:    { type: String, required: [true, 'Password is required'], select: false },
  role:        { type: String, enum: ['ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER'], required: [true, '{VALUE} is not a valid role'] },
  department:  { type: Types.ObjectId, ref: 'department' },
  isActive:    { type: Boolean, default: true },
  profileImageUrl: { type: String },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

export const UserModel = model('user', userSchema)
