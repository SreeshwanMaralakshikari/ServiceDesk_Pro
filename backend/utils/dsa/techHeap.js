import { MinHeap } from './MinHeap.js'

// A technician row: { id, skills: [], openTickets, lastAssignedAt (Date|null) }
const idText = (t) => String(t.id)
const time = (d) => (d ? new Date(d).getTime() : 0)

export const matchedSkills = (tech, wanted) => {
  const have = new Set((tech.skills || []).map((s) => s.toLowerCase()))
  return (wanted || []).filter((s) => have.has(s.toLowerCase()))
}

// who should get the ticket first: lowest open load, then more matched skills,
// then the one who was assigned least recently, then id so the order is stable
export const compareTechnicians = (a, b) => {
  if (a.openTickets !== b.openTickets) return a.openTickets - b.openTickets
  if (a.matched !== b.matched) return b.matched - a.matched
  const ta = time(a.lastAssignedAt)
  const tb = time(b.lastAssignedAt)
  if (ta !== tb) return ta - tb
  return idText(a) < idText(b) ? -1 : idText(a) > idText(b) ? 1 : 0
}

// pool = technicians with at least one matching skill when any exist, else everyone
export const rankTechnicians = (technicians, wantedSkills = [], limit = Infinity) => {
  const scored = technicians.map((t) => ({ ...t, matched: matchedSkills(t, wantedSkills).length }))
  const skilled = scored.filter((t) => t.matched > 0)
  const pool = skilled.length > 0 ? skilled : scored
  return new MinHeap(compareTechnicians, pool).drain(limit)
}

export const pickTechnician = (technicians, wantedSkills = []) => rankTechnicians(technicians, wantedSkills, 1)[0] || null
