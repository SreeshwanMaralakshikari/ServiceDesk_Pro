import { create } from 'zustand'
import { axiosInstance } from '../axiosInstance.js'

export const useAuthStore = create((set) => ({
  user: null,
  isAuthenticated: false,
  isChecking: true,

  checkAuth: async () => {
    try {
      const { data } = await axiosInstance.get('/auth/check-auth')
      set({ user: data.payload, isAuthenticated: true, isChecking: false })
    } catch {
      set({ user: null, isAuthenticated: false, isChecking: false })
    }
  },

  login: async (email, password) => {
    const { data } = await axiosInstance.post('/auth/login', { email, password })
    set({ user: data.payload, isAuthenticated: true, isChecking: false })
    return data.payload
  },

  logout: async () => {
    await axiosInstance.get('/auth/logout')
    set({ user: null, isAuthenticated: false })
  },
}))
