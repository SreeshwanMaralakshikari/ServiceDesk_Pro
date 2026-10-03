import { Schema, model } from 'mongoose'

// one row per PREFIX-YEAR (for example "TKT-2026"); seq is the last number handed out
const counterSchema = new Schema({
  _id: { type: String },
  seq: { type: Number, required: true, default: 0 },
}, {
  versionKey: false,
  strict: 'throw',
})

export const CounterModel = model('counter', counterSchema)
