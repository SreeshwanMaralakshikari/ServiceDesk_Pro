// Runs every QA check plus the test suite and prints one PASS/FAIL line each.
//   node qa/run-all.mjs        (from the project root)
// Exit code is non-zero if anything fails, so it can gate a commit or CI step.
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const checks = [
  ['backend syntax (node --check)',   [path.join(here, 'syntax.mjs')],              root],
  ['tests (npm test)',                ['--test'],                                   path.join(root, 'backend')],
  ['static analysis',                 [path.join(here, 'static-analysis.mjs')],     root],
  ['frontend imports/exports',        [path.join(here, 'frontend-imports.mjs')],    root],
  ['routes vs frontend calls',        [path.join(here, 'routes-vs-frontend.mjs')],  root],
  ['frontend links vs router',        [path.join(here, 'frontend-links.mjs')],      root],
  ['mongoose refs + populate paths',  [path.join(here, 'model-refs.mjs')],          root],
  ['dependencies declared/locked/installed', [path.join(here, 'dependencies.mjs')], root],
  ['seed scenarios A-E',              [path.join(here, 'seed-scenarios.mjs')],      root],
]
let failed = 0
for (const [name, args, cwd] of checks) {
  const r = spawnSync(process.execPath, args, { cwd, encoding: 'utf8', timeout: 240000 })
  const ok = r.status === 0
  if (!ok) failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
  if (!ok) console.log((r.stdout + r.stderr).split('\n').filter(Boolean).slice(-12).map((l) => '      ' + l).join('\n'))
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
