import jwt from 'jsonwebtoken'
import { config } from 'dotenv'
import { UserModel } from '../models/UserModel.js'

const { verify } = jwt
config()

// factory: verifyToken("ADMIN", "MANAGER") -> middleware allowing only those roles
// (call with no args to just require any authenticated, active user)
export const verifyToken = (...allowedRoles) => {
  return async (req, res, next) => {
    const token = req.cookies?.token

    if (!token) {
      //send res
      return res.status(401).json({ message: 'Please login first' })
    }
    try {
      const decoded = verify(token, process.env.JWT_SECRET)

      // always trust the DB for role/department/active state, not the token's
      // copy, so an admin's edit takes effect immediately
      const user = await UserModel.findById(decoded.id).select('role department isActive')
      if (!user || !user.isActive) {
        //send res
        return res.status(401).json({ message: 'Account not found or deactivated' })
      }
      if (allowedRoles.length && !allowedRoles.includes(user.role)) {
        //send res
        return res.status(403).json({ message: 'You are not authorized for this action' })
      }

      req.user = { id: user._id.toString(), role: user.role, department: user.department?.toString() }
      next()
    } catch (err) {
      //send res
      res.status(401).json({ message: 'Session expired, please login again' })
    }
  }
}
