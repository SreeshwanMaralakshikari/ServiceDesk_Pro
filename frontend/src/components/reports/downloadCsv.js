import { axiosInstance } from '../../axiosInstance.js'

// fetch a CSV with the session cookie and hand it to the browser as a file.
// Resolves { rows, truncated }. Errors come back as a blob, so the message is read out of it.
export const downloadCsv = async (url, params, fallbackName) => {
  try {
    const res = await axiosInstance.get(url, { params, responseType: 'blob' })
    const name = /filename="?([^";]+)"?/.exec(res.headers['content-disposition'] ?? '')?.[1] ?? fallbackName
    const href = URL.createObjectURL(res.data)
    const a = document.createElement('a')
    a.href = href
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(href)
    return { rows: Number(res.headers['x-row-count'] ?? 0), truncated: res.headers['x-truncated'] === 'true' }
  } catch (err) {
    if (typeof err?.response?.data?.text === 'function') {
      let message = ''
      try {
        const body = JSON.parse(await err.response.data.text())
        message = body.error || body.message || ''
      } catch { /* not JSON, fall through */ }
      if (message) throw new Error(message, { cause: err })
    }
    throw err
  }
}
