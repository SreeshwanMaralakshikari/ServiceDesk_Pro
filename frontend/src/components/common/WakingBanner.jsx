import { useNetworkStore } from '../../store/networkStore.js'

// shown while any request has been pending for a few seconds (free-tier cold start)
export const WakingBanner = () => {
  const slow = useNetworkStore((s) => s.slowCount > 0)
  if (!slow) return null
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-800 text-sm text-center py-2 px-4" role="status">
      Waking the server up… the first request after a quiet spell can take up to a minute.
    </div>
  )
}
