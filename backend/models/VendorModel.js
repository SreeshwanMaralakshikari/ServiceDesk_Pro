import { Schema, model } from 'mongoose'

const vendorSchema = new Schema({
  name:             { type: String, required: [true, 'Name is required'], unique: true },
  contactPerson:    { type: String },
  email:            { type: String, lowercase: true, trim: true },
  phone:            { type: String },
  address:          { type: String },
  servicesProvided: { type: String },
  isActive:         { type: Boolean, default: true },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

export const VendorModel = model('vendor', vendorSchema)
