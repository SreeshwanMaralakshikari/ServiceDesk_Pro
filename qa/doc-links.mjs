// Checks the project's documentation the way a reader would meet it:
//   - the three README files exist, named exactly README.md (root, backend/, frontend/)
//   - every relative link in a README or in docs/ points at a file that exists
//   - every #anchor in those links matches a heading in the target file (GitHub's anchor rules)
//   - every code fence is closed
//   node qa/doc-links.mjs        (from the project root; run by qa/run-all.mjs)
// Web links (http, https, mailto) are not fetched.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const problems = []

// the README rule: one per app plus the project front door, upper-case name
for (const dir of ['', 'backend', 'frontend']) {
  const names = existsSync(path.join(root, dir)) ? readdirSync(path.join(root, dir)) : []
  if (!names.includes('README.md')) {
    const near = names.find((n) => n.toLowerCase() === 'readme.md')
    problems.push(`${dir || '(project root)'}: no README.md${near ? ` (found ${near}; rename it to README.md)` : ''}`)
  }
}

// which files to read: the READMEs and everything under docs/
const files = ['README.md', 'backend/README.md', 'frontend/README.md'].map((f) => path.join(root, f)).filter((f) => existsSync(f))
const walk = (dir) => {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (entry.name.endsWith('.md')) files.push(p)
  }
}
walk(path.join(root, 'docs'))

// code blocks and inline code never hold links
const stripCode = (text) => text.replace(/^(```|~~~)[\s\S]*?^\1/gm, '').replace(/`[^`\n]*`/g, '')

// GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens, repeats get -1, -2
const anchorsOf = (file) => {
  const seen = new Map()
  const anchors = new Set()
  const text = readFileSync(file, 'utf8').replace(/^(```|~~~)[\s\S]*?^\1/gm, '')
  for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = m[1].replace(/`/g, '').toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-')
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    anchors.add(n === 0 ? base : `${base}-${n}`)
  }
  return anchors
}

let linkCount = 0
for (const file of files) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  const text = readFileSync(file, 'utf8')
  const fences = text.match(/^(```|~~~)/gm) ?? []
  if (fences.length % 2) problems.push(`${rel}: a code fence is not closed`)
  for (const m of stripCode(text).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = m[1]
    if (/^(https?:|mailto:)/.test(href)) continue
    linkCount++
    const [target, hash] = href.split('#')
    const resolved = target ? path.resolve(path.dirname(file), decodeURI(target)) : file
    if (!existsSync(resolved)) {
      problems.push(`${rel}: link to ${href}: no such file`)
      continue
    }
    if (hash && statSync(resolved).isFile() && resolved.endsWith('.md') && !anchorsOf(resolved).has(hash)) {
      problems.push(`${rel}: link to ${href}: no heading with that anchor`)
    }
  }
}

if (problems.length) {
  console.log(problems.join('\n'))
  console.log(`\n${problems.length} documentation problem(s)`)
  process.exit(1)
}
console.log(`${files.length} documents, ${linkCount} relative links, all resolve`)
