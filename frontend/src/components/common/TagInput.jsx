import { useState } from 'react'
import { styles } from '../../styles/common.js'

// edits a list of lowercase tags (skills): Enter or comma adds, × removes.
// The server has the final say on what a valid tag is
export const TagInput = ({ label, value = [], onChange, placeholder = 'type a skill and press Enter' }) => {
  const [draft, setDraft] = useState('')

  const add = () => {
    const tag = draft.trim().toLowerCase().replace(/\s+/g, ' ')
    setDraft('')
    if (tag && !value.includes(tag)) onChange([...value, tag])
  }
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !draft && value.length) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div className="mb-3">
      <span className={styles.label}>{label}</span>
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-300 px-2 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500">
        {value.map((tag) => (
          <span key={tag} className={styles.chip}>
            {tag}
            <button type="button" className="ml-1 text-slate-400 hover:text-red-600" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>×</button>
          </span>
        ))}
        <input className="flex-1 min-w-[8rem] text-sm outline-none py-0.5" value={draft} placeholder={placeholder} aria-label={`${label} input`}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKeyDown} onBlur={add} />
      </div>
    </div>
  )
}
