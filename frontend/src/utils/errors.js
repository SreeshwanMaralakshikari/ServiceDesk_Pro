// The API answers errors in two shapes:
//   route-level checks:   { message: 'invalid category' }
//   global error handler: { message: 'error occurred', error: 'Title is required' }
// so the useful text is `error` when present, otherwise `message`. Showing
// `message` first (as most pages do) would just display "error occurred".
export const getErrorMessage = (err, fallback = 'Something went wrong') => {
  const data = err?.response?.data
  if (typeof data?.error === 'string' && data.error) return data.error
  if (typeof data?.message === 'string' && data.message) return data.message
  if (err?.request && !err?.response) return 'Cannot reach the server — check your connection'
  return fallback
}
