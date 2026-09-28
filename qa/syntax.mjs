// QA: `node --check` on every backend .js file (excluding node_modules)
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const backend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'backend')
const files = []
;(function walk(d) { for (const f of readdirSync(d)) { if (f === 'node_modules') continue; const p = path.join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') && files.push(p) } })(backend)
let bad = 0
for (const f of files) { const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' }); if (r.status !== 0) { bad++; console.log('SYNTAX ERROR', path.relative(backend, f)); console.log(r.stderr.split('\n').slice(0, 6).join('\n')) } }
console.log(`${files.length} backend files checked, syntax errors: ${bad}`)
process.exit(bad ? 1 : 0)
