// QA: scope-aware scan for undefined identifiers and unused imports (backend + frontend/src)
import { fileURLToPath, pathToFileURL } from 'url'
import nodePath from 'path'
// portable: everything is resolved relative to this file, and dynamic import()
// gets a file:// URL (a bare absolute path breaks on Windows)
const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const load = (p) => import(pathToFileURL(p).href)
import fs from 'fs'; import path from 'path'
const FE=(ROOT+'/frontend/node_modules/')
const { parse } = await load(FE+'@babel/parser/lib/index.js')
const traverse = (await load(FE+'@babel/traverse/lib/index.js')).default.default ?? (await load(FE+'@babel/traverse/lib/index.js')).default
const GLOBALS=new Set('process console Buffer setTimeout setInterval clearInterval clearTimeout Date Promise Math JSON Object Array Number String Boolean Error RegExp Set Map URL fetch isNaN parseInt parseFloat undefined NaN Infinity Symbol encodeURIComponent decodeURIComponent window document localStorage sessionStorage globalThis Intl Number BigInt WeakMap Reflect Proxy TypeError RangeError AbortController URLSearchParams FormData Event navigator alert confirm requestAnimationFrame global require module exports __dirname __filename structuredClone queueMicrotask performance TextEncoder TextDecoder'.split(' '))
const roots=[['backend',(ROOT+'/backend'),['node_modules']],['frontend',(ROOT+'/frontend/src'),[]]]
let problems=0, files=0
for(const [label,root,skip] of roots){
  const list=[]; (function walk(d){for(const f of fs.readdirSync(d)){ if(skip.includes(f)) continue; const p=path.join(d,f); fs.statSync(p).isDirectory()?walk(p):/\.(jsx?|mjs)$/.test(f)&&list.push(p)}})(root)
  for(const f of list){ files++
    const src=fs.readFileSync(f,'utf8'); const ast=parse(src,{sourceType:'module',plugins:['jsx'],allowAwaitOutsideFunction:true})
    traverse(ast,{
      ReferencedIdentifier(p){ const n=p.node.name; if(p.isJSXIdentifier() && /^[a-z]/.test(n)) return
        if(!p.scope.hasBinding(n) && !GLOBALS.has(n)){ console.log(`UNDEFINED  ${label}/${path.relative(root,f)}:${p.node.loc.start.line}  ${n}`); problems++ } },
      Program:{ exit(p){ for(const [name,b] of Object.entries(p.scope.bindings)){ if(b.kind==='module' && !b.referenced){ console.log(`unused import ${label}/${path.relative(root,f)}  ${name}`) } } } }
    })
  }
}
console.log(`${files} files scanned, undefined-identifier problems: ${problems}`)
process.exit(problems ? 1 : 0)
