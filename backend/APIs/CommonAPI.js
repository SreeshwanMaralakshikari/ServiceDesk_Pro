import exp from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import rateLimit from 'express-rate-limit'
import { UserModel } from '../models/UserModel.js'
import { verifyToken } from '../middlewares/verifyToken.js'

export const commonApp = exp.Router()

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, standardHeaders: true, legacyHeaders: false })

const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: process.env.NODE_ENV === 'production' ? 'lax' : 'lax',
  maxAge: 24 * 60 * 60 * 1000, // 1 day, matches JWT_EXPIRES_IN default
})

// self-register: always EMPLOYEE, role/department never trusted from elsewhere
commonApp.post('/users', async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, department } = req.body
    if (!firstName || !email || !password || !department) {
      //send res
      return res.status(400).json({ message: 'firstName, email, password and department are required' })
    }
    const hashed = await bcrypt.hash(password, 10)
    const user = await UserModel.create({ firstName, lastName, email, password: hashed, role: 'EMPLOYEE', department })
    //send res
    res.status(201).json({ message: 'registered successfully', payload: { id: user._id } })
  } catch (err) {
    next(err)
  }
})

commonApp.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = req.body
    if (!email || !password) {
      //send res
      return res.status(400).json({ message: 'email and password are required' })
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
    const { currentPassword, newPassword } = req.body
    const user = await UserModel.findById(req.user.id).select('+password')
    const match = await bcrypt.compare(currentPassword, user.password)
    if (!match) {
      //send res
      return res.status(401).json({ message: 'current password is incorrect' })
    }
    user.password = await bcrypt.hash(newPassword, 10)
    await user.save()
    res.clearCookie('token', { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' })
    //send res
    res.status(200).json({ message: 'password changed, please login again' })
  } catch (err) {
    next(err)
  }
})
