// QA: every third-party package imported is declared in package.json, in the lockfile and installed
import { fileURLToPath, pathToFileURL } from 'url'
import nodePath from 'path'
// portable: everything is resolved relative to this file, and dynamic import()
// gets a file:// URL (a bare absolute path breaks on Windows)
const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const load = (p) => import(pathToFileURL(p).href)
import fs from 'fs'; import path from 'path'; import { builtinModules } from 'module'
let flagged=0
for(const [label,root,src] of [['backend',(ROOT+'/backend'),['.']],['frontend',(ROOT+'/frontend'),['src']]]){
  const pkg=JSON.parse(fs.readFileSync(root+'/package.json','utf8')); const declared={...pkg.dependencies,...pkg.devDependencies}
  const lock=fs.existsSync(root+'/package-lock.json')?JSON.parse(fs.readFileSync(root+'/package-lock.json','utf8')).packages:{}
  const files=[]; const walk=(d)=>{for(const f of fs.readdirSync(d)){ if(f==='node_modules'||f==='dist') continue; const p=path.join(d,f); fs.statSync(p).isDirectory()?walk(p):/\.(jsx?|mjs)$/.test(f)&&files.push(p)}}
  src.forEach(s=>walk(path.join(root,s)))
  const used=new Map()
  for(const f of files){ const t=fs.readFileSync(f,'utf8')
    for(const m of t.matchAll(/(?:^|\n)\s*import[^'"\n]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)){
      const spec=m[1]||m[2]||m[3]; if(spec.startsWith('.')||spec.startsWith('/')||spec.startsWith('node:')||spec.startsWith('@/')) continue
      const name=spec.startsWith('@')?spec.split('/').slice(0,2).join('/'):spec.split('/')[0]
      if(builtinModules.includes(name)) continue; if(!used.has(name)) used.set(name,path.relative(root,f)) } }
  console.log(`== ${label}: ${used.size} third-party packages imported by source`)
  for(const [name,file] of [...used].sort()){
    const inPkg=name in declared, installed=fs.existsSync(`${root}/node_modules/${name}`), inLock=Boolean(lock[`node_modules/${name}`])
    const flag=(!inPkg||!installed||!inLock)?'  <-- ':''
    if(flag) flagged++
    if(flag) console.log(`${flag}${name.padEnd(22)} declared:${inPkg} installed:${installed} in-lockfile:${inLock}   (first used in ${file})`) }
}
process.exit(flagged ? 1 : 0)
