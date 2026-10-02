import { useCallback, useEffect, useState } from 'react'
import { axiosInstance } from '../axiosInstance.js'
import { getErrorMessage } from '../utils/errors.js'

// GET a URL and keep { data, loading, error }. The request is aborted when the
// component unmounts or the URL/params change, so a slow earlier response can
// never overwrite a newer one. Pass `null` as the url to skip fetching.
// `reload()` fetches again with the same arguments.
export const useFetch = (url, params) => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(Boolean(url))
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)
  // params is an object that changes identity every render; compare by value
  const paramsKey = JSON.stringify(params ?? {})

  useEffect(() => {
    if (!url) {
      setData(null)
      setLoading(false)
      return undefined
    }
    const controller = new AbortController()
    setLoading(true)
    setError(null)
    axiosInstance.get(url, { params: JSON.parse(paramsKey), signal: controller.signal })
      .then(({ data: body }) => setData(body.payload))
      .catch((err) => {
        if (controller.signal.aborted) return
        setError(getErrorMessage(err, 'Failed to load'))
        setData(null)
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [url, paramsKey, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, loading, error, reload }
}
