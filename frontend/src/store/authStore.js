import { create } from 'zustand'
import { axiosInstance } from '../axiosInstance.js'

// bumped by every auth action; lets a slow check-auth response know it is out of date
let authEpoch = 0

export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isChecking: true,

  checkAuth: async () => {
    const startedAt = ++authEpoch
    try {
      const { data } = await axiosInstance.get('/auth/check-auth')
      if (startedAt !== authEpoch) return // a login or logout happened meanwhile: that result wins
      set({ user: data.payload, isAuthenticated: true, isChecking: false })
    } catch {
      if (startedAt !== authEpoch) return
      set({ user: null, isAuthenticated: false, isChecking: false })
    }
  },

  login: async (email, password) => {
    const { data } = await axiosInstance.post('/auth/login', { email, password })
    authEpoch += 1
    set({ user: data.payload, isAuthenticated: true, isChecking: false })
    return data.payload
  },

  logout: async () => {
    // clear local state even if the request fails, so the user is never stuck "logged in" in the UI
    authEpoch += 1
    try {
      await axiosInstance.post('/auth/logout')
    } finally {
      set({ user: null, isAuthenticated: false, isChecking: false })
    }
  },
}))
