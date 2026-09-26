import { Schema, model } from 'mongoose'

// single-document collection — always looked up with findOne(), never by id
const orgSettingsSchema = new Schema({
  orgName: { type: String, default: 'ServiceDesk Pro' },
  businessHours: {
    days:     { type: [Number], default: [1, 2, 3, 4, 5] }, // JS getDay(): 0=Sun .. 6=Sat, so Mon-Fri = 1-5
    start:    { type: String, default: '09:00' },            // "HH:mm", interpreted in `timezone`
    end:      { type: String, default: '18:00' },
    timezone: { type: String, default: 'Asia/Kolkata' },      // fixed +05:30, no DST — see utils/businessHours.js
  },
}, {
  versionKey: false,
  timestamps: true,
  strict: 'throw',
})

export const OrgSettingsModel = model('orgsettings', orgSettingsSchema)

// there is ever only one OrgSettings doc — this creates it on first use
export const getOrgSettings = async () => {
  let settings = await OrgSettingsModel.findOne()
  if (!settings) settings = await OrgSettingsModel.create({})
  return settings
}
