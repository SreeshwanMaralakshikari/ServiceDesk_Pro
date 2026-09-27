import { Schema, model, Types } from 'mongoose'

const maintenanceEntrySchema = new Schema({
  date:   { type: Date, default: Date.now },
  type:   { type: String, required: [true, 'Maintenance type is required'] }, // e.g. "Repair", "Inspection"
  vendor: { type: Types.ObjectId, ref: 'vendor' },
  cost:   { type: Number },
  note:   { type: String },
}, { _id: false, strict: 'throw' })

const lifecycleEntrySchema = new Schema({
  fromStatus: { type: String },
  toStatus:   { type: String, required: true },
  by:         { type: Types.ObjectId, ref: 'user' },
  note:       { type: String },
  at:         { type: Date, default: Date.now },
}, { _id: false, strict: 'throw' })

const assetSchema = new Schema({
  publicId:      { type: String, unique: true },
  name:          { type: String, required: [true, 'Name is required'] },
  type:          { type: String, enum: ['HARDWARE', 'SOFTWARE'], required: [true, '{VALUE} is not a valid type'] },
  // deliberately not "category" — avoids confusion with ticket Category
  assetClass:    { type: String, required: [true, 'Asset class is required'] }, // e.g. "Laptop", "Monitor", "License"
  serialNumber:  { type: String }, // hardware
  licenseKey:    { type: String }, // software
  vendor:        { type: Types.ObjectId, ref: 'vendor' },
  purchaseDate:  { type: Date },
  purchaseCost:  { type: Number },
  warrantyExpiry:   { type: Date },
  warrantyNotified: { type: Boolean, default: false }, // reset to false whenever warrantyExpiry is edited

  status: {
    type: String,
    enum: ['PROCURED', 'IN_STOCK', 'ASSIGNED', 'IN_REPAIR', 'REPLACED', 'RETIRED'],
    default: 'PROCURED',
  },

  assignedTo: { type: Types.ObjectId, ref: 'user' }, // kept while IN_REPAIR so it returns to the same person
  department: { type: Types.ObjectId, ref: 'department' },
  location:   { type: String },

  replaces:   { type: Types.ObjectId, ref: 'asset' }, // this asset replaced that one
  replacedBy: { type: Types.ObjectId, ref: 'asset' }, // that asset replaced this one

  maintenance:      [maintenanceEntrySchema],
  lifecycleHistory: [lifecycleEntrySchema],

  version:   { type: Number, default: 0 }, // optimistic concurrency guard, same pattern as Ticket
  isDeleted: { type: Boolean, default: false },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

assetSchema.index({ status: 1, department: 1 })
assetSchema.index({ assignedTo: 1 })
assetSchema.index({ warrantyExpiry: 1, warrantyNotified: 1 })
assetSchema.index({ name: 'text', assetClass: 'text', serialNumber: 'text' })

export const AssetModel = model('asset', assetSchema)
