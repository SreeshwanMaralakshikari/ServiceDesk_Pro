import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { styles } from '../../styles/common.js'

// a password box with a show/hide button. Every other prop goes to the <input>
export const PasswordInput = ({ className = '', ...props }) => {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input {...props} type={visible ? 'text' : 'password'} className={`${styles.input} pr-10 ${className}`} />
      <button type="button" onClick={() => setVisible((v) => !v)}
        className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-600"
        aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible}>
        {visible ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
}
