import axios from 'axios'
import { useNetworkStore } from './store/networkStore.js'

const TIMEOUT_MS = 20000 // a cold Render start can take longer; GETs are retried once below
const SLOW_AFTER_MS = 4000 // show the "waking the server" banner after this
const RETRY_DELAY_MS = 1500

// baseURL "/api" works in both dev (Vite proxy) and prod (Vercel rewrite)
export const axiosInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
  timeout: TIMEOUT_MS,
})

const bump = (delta) => useNetworkStore.setState((s) => ({ slowCount: Math.max(0, s.slowCount + delta) }))

// per-request bookkeeping for the slow-request banner
const settle = (config) => {
  if (!config) return
  clearTimeout(config.__slowTimer)
  if (config.__slowShown) {
    config.__slowShown = false
    bump(-1)
  }
}

axiosInstance.interceptors.request.use((config) => {
  config.__slowTimer = setTimeout(() => {
    config.__slowShown = true
    bump(1)
  }, SLOW_AFTER_MS)
  return config
})

// no response at all (network error or timeout) or a gateway error while the
// service is starting up: worth exactly one more try, for GET requests only
// (a repeated POST/PATCH could do the same thing twice)
const isRetryable = (error) => {
  const method = (error.config?.method || '').toLowerCase()
  if (method !== 'get') return false
  if (error.config.__retried) return false
  if (error.response) return [502, 503, 504].includes(error.response.status)
  return error.code === 'ECONNABORTED' || error.code === 'ERR_NETWORK'
}

axiosInstance.interceptors.response.use(
  (response) => {
    settle(response.config)
    return response
  },
  async (error) => {
    settle(error.config)
    if (isRetryable(error)) {
      error.config.__retried = true
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
      return axiosInstance(error.config)
    }
    return Promise.reject(error)
  },
)
