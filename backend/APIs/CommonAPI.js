import exp from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { UserModel } from '../models/UserModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'
import { loginLimiter, loginEmailLimiter, registerLimiter } from '../middlewares/rateLimiters.js'
import { logAudit } from '../utils/logAudit.js'
import { validateRoleDepartment } from '../utils/validateRoleDepartment.js'

export const commonApp = exp.Router()

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
  maxAge: 24 * 60 * 60 * 1000, // 1 day, matches JWT_EXPIRES_IN default
})

// applies to a NEW password only; existing accounts keep theirs until they change it
const MIN_NEW_PASSWORD_LENGTH = 12

// self-register: always EMPLOYEE, role/department never trusted from elsewhere
commonApp.post('/users', registerLimiter, async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, department } = req.body ?? {}
    if (!firstName || !email || !password || !department) {
      //send res
      return res.status(400).json({ message: 'firstName, email, password and department are required' })
    }
    if (![firstName, email, password, department].every((v) => typeof v === 'string') || (lastName !== undefined && typeof lastName !== 'string')) {
      //send res
      return res.status(400).json({ message: 'firstName, lastName, email, password and department must be text' })
    }
    // self-registration is always EMPLOYEE, so the department must be a BUSINESS one
    const deptError = await validateRoleDepartment('EMPLOYEE', department)
    if (deptError) {
      //send res
      return res.status(400).json({ message: deptError })
    }
    const hashed = await bcrypt.hash(password, 10)
    const user = await UserModel.create({ firstName, lastName, email, password: hashed, role: 'EMPLOYEE', department })
    //send res
    res.status(201).json({ message: 'registered successfully', payload: { id: user._id } })
  } catch (err) {
    next(err)
  }
})

commonApp.post('/login', loginLimiter, loginEmailLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body ?? {}
    if (!email || !password) {
      //send res
      return res.status(400).json({ message: 'email and password are required' })
    }
    if (typeof email !== 'string' || typeof password !== 'string') {
      //send res
      return res.status(400).json({ message: 'email and password must be text' })
    }
    // temporary diagnostic for F-036: set LOG_CLIENT_IP=true on Render, log in once, read the
    // Render log to pick TRUST_PROXY_HOPS, then remove the variable
    if (process.env.LOG_CLIENT_IP === 'true') {
      console.log('login ip debug:', { ip: req.ip, ips: req.ips, xForwardedFor: req.headers['x-forwarded-for'] })
    }
    const user = await UserModel.findOne({ email: email.toLowerCase() }).select('+password')
    if (!user || !user.isActive) {
      //send res
      return res.status(401).json({ message: 'invalid credentials' })
    }
    const match = await bcrypt.compare(password, user.password)
    if (!match) {
      //send res
      return res.status(401).json({ message: 'invalid credentials' })
    }

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || '1d',
    })
    res.cookie('token', token, cookieOptions())

    const safeUser = user.toObject()
    delete safeUser.password
    await logAudit({ req, actor: user._id, action: 'LOGIN', entityType: 'USER', entity: user })
    //send res
    res.status(200).json({ message: 'login successful', payload: safeUser })
  } catch (err) {
    next(err)
  }
})

commonApp.get('/logout', (req, res) => {
  res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
  //send res
  res.status(200).json({ message: 'logged out' })
})

commonApp.get('/check-auth', verifyToken('ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER'), async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user.id).populate('department', 'name kind')
    //send res
    res.status(200).json({ message: 'authenticated', payload: user })
  } catch (err) {
    next(err)
  }
})

commonApp.put('/password', verifyToken('ADMIN', 'MANAGER', 'TECHNICIAN', 'EMPLOYEE', 'ASSET_MANAGER'), async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body ?? {}
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !newPassword) {
      //send res
      return res.status(400).json({ message: 'currentPassword and newPassword are required' })
    }
    if (newPassword.length < MIN_NEW_PASSWORD_LENGTH || newPassword.length > 72) {
      //send res
      return res.status(400).json({ message: `new password must be ${MIN_NEW_PASSWORD_LENGTH}-72 characters` })
    }
    const user = await UserModel.findById(req.user.id).select('+password')
    const match = await bcrypt.compare(currentPassword, user.password)
    if (!match) {
      //send res
      return res.status(401).json({ message: 'current password is incorrect' })
    }
    user.password = await bcrypt.hash(newPassword, 10)
    await user.save()
    await logAudit({ req, action: 'PASSWORD_CHANGED', entityType: 'USER', entity: user })
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
    //send res
    res.status(200).json({ message: 'password changed, please login again' })
  } catch (err) {
    next(err)
  }
})
