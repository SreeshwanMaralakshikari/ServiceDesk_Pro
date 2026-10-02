import toast from 'react-hot-toast'
import { getErrorMessage } from './errors.js'

// run a write request: success toast + true, or the server's own message
// (the 409 rules explain themselves) as an error toast + false
export const runAction = async (request, successMessage) => {
  try {
    await request()
    toast.success(successMessage)
    return true
  } catch (err) {
    toast.error(getErrorMessage(err, 'That did not work'))
    return false
  }
}
