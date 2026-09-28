// QA: all backend routes in registration order vs every frontend axios call - unmatched calls and first-match route shadowing
process.env.JWT_SECRET='x'; process.env.MONGO_URI='x'; process.env.CLIENT_URL='x'
import { fileURLToPath, pathToFileURL } from 'url'
import nodePath from 'path'
// portable: everything is resolved relative to this file, and dynamic import()
// gets a file:// URL (a bare absolute path breaks on Windows)
const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const load = (p) => import(pathToFileURL(p).href)
import fs from 'fs'; import path from 'path'
const B=(ROOT+'/backend/'), F=(ROOT+'/frontend/src')
// 1) mounts from server.js -> real routers, real registration order
const server=fs.readFileSync(B+'server.js','utf8')
const imports=Object.fromEntries([...server.matchAll(/import \{ (\w+) \} from '\.\/APIs\/(\w+)\.js'/g)].map(m=>[m[1],m[2]]))
const routes=[]
for(const m of server.matchAll(/app\.use\('(\/[\w-]+)', (\w+)\)/g)){
  const [_,prefix,name]=m; if(!imports[name]) continue
  const mod=await load(B+'APIs/'+imports[name]+'.js')
  for(const l of mod[name].stack){ if(!l.route) continue
    for(const method of Object.keys(l.route.methods)) routes.push({method:method.toUpperCase(),path:prefix+(l.route.path==='/'?'':l.route.path),router:name}) } }
console.log(`backend: ${routes.length} routes across ${new Set(routes.map(r=>r.router)).size} routers`)
const toRe=(p)=>new RegExp('^'+p.replace(/:[^/]+/g,'[^/]+')+'$')
const seg=(p)=>p.split('/').filter(Boolean)
// 2) backend-internal shadowing, ALL routers: an earlier same-method route whose params would also capture a later literal route
let shadow=0
routes.forEach((a,i)=>routes.forEach((b,j)=>{ if(j>i&&a.method===b.method&&a.router===b.router){ const sa=seg(a.path),sb=seg(b.path)
  if(sa.length===sb.length&&sa.join()!==sb.join()&&sa.every((x,k)=>x.startsWith(':')||x===sb[k])&&sb.some((x,k)=>!x.startsWith(':')&&sa[k].startsWith(':'))){ console.log(`SHADOWED  ${a.method} ${a.path}  (earlier) captures  ${b.path}`); shadow++ } } }))
console.log('backend route-shadowing problems:',shadow)
// 3) frontend calls
const files=[]; (function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f); fs.statSync(p).isDirectory()?walk(p):/\.jsx?$/.test(f)&&files.push(p)}})(F)
const calls=[]; let dynamic=0
for(const f of files){ const src=fs.readFileSync(f,'utf8')
  for(const m of src.matchAll(/axiosInstance\s*\.\s*(get|post|put|patch|delete)\(\s*([`'"])([\s\S]*?)\2/g)){
    calls.push({file:path.relative(F,f),method:m[1].toUpperCase(),raw:m[3],url:'/'+m[3].replace(/^\//,'').replace(/\$\{[^}]*\}/g,'PARAM').split('?')[0]}) }
  dynamic+=[...src.matchAll(/axiosInstance\s*\.\s*(get|post|put|patch|delete)\(\s*(?![`'"])/g)].length }
console.log(`frontend: ${calls.length} literal calls (+${dynamic} built from variables, checked by hand below)`)
let bad=0
for(const c of calls){
  if(c.url.startsWith('/auth')&&false) continue
  const matches=routes.filter(r=>r.method===c.method&&toRe(r.path).test(c.url))
  if(!matches.length){ console.log(`NO BACKEND ROUTE  ${c.method} ${c.url}   (${c.file})`); bad++; continue }
  const literalOnly=!c.url.split('/').includes('PARAM')
  if(literalOnly){ const first=matches[0]; const best=matches.slice().sort((x,y)=>seg(y.path).filter(s=>!s.startsWith(':')).length-seg(x.path).filter(s=>!s.startsWith(':')).length)[0]
    if(first.path!==best.path){ console.log(`SHADOWED CALL  ${c.method} ${c.url}  served by ${first.path} instead of ${best.path}  (${c.file})`); bad++ } } }
console.log('frontend->backend problems:',bad)
process.exit(shadow + bad ? 1 : 0)
