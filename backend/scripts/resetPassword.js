// one-off: set a user's password directly in the database (no login needed).
//   $env:RESET_EMAIL="admin@sdp.test"; $env:RESET_PASSWORD="a-new-password-12+"; node scripts/resetPassword.js
// uses MONGO_URI from backend/.env. Never prints the password.
import './../config/loadEnv.js'
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { UserModel } from '../models/UserModel.js'

const email = (process.env.RESET_EMAIL || '').trim().toLowerCase()
const password = process.env.RESET_PASSWORD || ''

if (!email || password.length < 12) {
  console.log('set RESET_EMAIL and RESET_PASSWORD (at least 12 characters) first')
  process.exit(1)
}

await mongoose.connect(process.env.MONGO_URI, { serverSelectionTimeoutMS: 15000 })
const user = await UserModel.findOne({ email })
if (!user) {
  console.log(`no user with email ${email}`)
  await mongoose.connection.close()
  process.exit(1)
}
user.password = await bcrypt.hash(password, 10)
user.passwordChangedAt = new Date() // signs out every older session
await user.save()
console.log(`password reset for ${email} (${user.role})`)
await mongoose.connection.close()
