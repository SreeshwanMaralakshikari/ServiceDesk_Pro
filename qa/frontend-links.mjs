// QA: every Link/navigate target through react-router's real matchRoutes - dead links; prints how /kb routes resolve
import { fileURLToPath, pathToFileURL } from 'url'
import nodePath from 'path'
// portable: everything is resolved relative to this file, and dynamic import()
// gets a file:// URL (a bare absolute path breaks on Windows)
const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const load = (p) => import(pathToFileURL(p).href)
import fs from 'fs'; import path from 'path'
const FE=(ROOT+'/frontend/')
const { parse } = await load(FE+'node_modules/@babel/parser/lib/index.js')
const { matchRoutes } = await load(FE+'node_modules/react-router/dist/development/index.mjs')
const src=fs.readFileSync(FE+'src/App.jsx','utf8'); const ast=parse(src,{sourceType:'module',plugins:['jsx']})
let arr; (function find(n){ if(!n||typeof n!=='object') return; if(n.type==='CallExpression'&&n.callee.name==='createBrowserRouter') arr=n.arguments[0]; for(const k in n){ const v=n[k]; Array.isArray(v)?v.forEach(find):(v&&v.type&&find(v)) } })(ast.program)
let uid=0
const conv=(obj)=>{ const r={id:'r'+(uid++),handle:{}}
  for(const p of obj.properties){ const k=p.key.name
    if(k==='path') r.path=p.value.value
    if(k==='index') r.index=true
    if(k==='children') r.children=p.value.elements.map(conv)
    if(k==='element'){ const el=p.value; const name=el.openingElement.name.name; r.handle.component=name
      const roles=el.openingElement.attributes.find(a=>a.name?.name==='allowedRoles'); if(roles) r.handle.roles=roles.value.expression.elements.map(e=>e.value) } }
  return r }
const routes=arr.elements.map(conv)
const resolve=(url)=>{ const m=matchRoutes(routes,url); if(!m) return null; const leaf=m[m.length-1].route.handle.component
  const roles=m.map(x=>x.route.handle.roles).filter(Boolean).pop(); return {leaf,roles} }
// every static target used in Links/navigate/Navigate across the frontend
const files=[]; (function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f); fs.statSync(p).isDirectory()?walk(p):/\.jsx?$/.test(f)&&files.push(p)}})(FE+'src')
const targets=new Map()
for(const f of files){ const s=fs.readFileSync(f,'utf8')
  const re=[/\bto=(?:"([^"]+)"|\{`([^`]+)`\}|\{'([^']+)'\})/g,/navigate\((?:'([^']+)'|`([^`]+)`)/g]
  for(const r of re) for(const m of s.matchAll(r)){ const t=(m[1]||m[2]||m[3]||m[4]||m[5]).replace(/\$\{[^}]*\}/g,'X'); if(t.startsWith('/')) targets.set(t,path.relative(FE+'src',f)) } }
let bad=0
for(const [t,f] of [...targets].sort()){ const r=resolve(t); const notFound=!r||r.leaf==='NotFound'
  if(notFound){ console.log(`DEAD LINK  ${t}   (${f})`); bad++ } }
console.log(`${targets.size} distinct link/navigate targets checked; dead links: ${bad}`)
console.log('\nKB routes as react-router really resolves them:')
for(const u of ['/kb','/kb/new','/kb/KB-2026-00001','/kb/KB-2026-00001/edit','/kb/new/edit']){ const r=resolve(u); console.log(' ',u.padEnd(26),'->',(r?.leaf||'NO MATCH').padEnd(14),'roles:',r?.roles?.join(',')) }
process.exit(bad ? 1 : 0)
