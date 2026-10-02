import { create } from 'zustand'

// how many requests have been pending longer than SLOW_AFTER_MS. Render's free
// tier sleeps, so the first request after a quiet spell can take ~50 s; while
// that is happening the app shows a "waking the server" banner instead of
// looking frozen.
export const useNetworkStore = create(() => ({ slowCount: 0 }))
