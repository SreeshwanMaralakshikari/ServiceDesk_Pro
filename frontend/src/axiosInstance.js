import axios from 'axios'

// baseURL "/api" works in both dev (Vite proxy) and prod (Vercel rewrite)
export const axiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
})
