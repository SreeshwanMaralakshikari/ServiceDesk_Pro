// QA: every frontend file parses as JSX and every relative import resolves to a real file + a real named export
import { fileURLToPath, pathToFileURL } from 'url'
import nodePath from 'path'
// portable: everything is resolved relative to this file, and dynamic import()
// gets a file:// URL (a bare absolute path breaks on Windows)
const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const load = (p) => import(pathToFileURL(p).href)
import fs from 'fs'; import path from 'path'
const { parse } = await load((ROOT+'/frontend/node_modules/@babel/parser/lib/index.js'))
const root=(ROOT+'/frontend/src')
const files=[]; (function walk(d){for(const f of fs.readdirSync(d)){const p=path.join(d,f); fs.statSync(p).isDirectory()?walk(p):/\.(jsx?|mjs)$/.test(f)&&files.push(p)}})(root)
let bad=0; const exportsOf={}
for(const f of files){
  const src=fs.readFileSync(f,'utf8'); let ast
  try{ ast=parse(src,{sourceType:'module',plugins:['jsx']}) }catch(e){ console.log('PARSE FAIL',path.relative(root,f),e.message); bad++; continue }
  exportsOf[f]=new Set(); 
  for(const n of ast.program.body){ if(n.type==='ExportNamedDeclaration'){ if(n.declaration?.declarations) n.declaration.declarations.forEach(d=>exportsOf[f].add(d.id.name)); else if(n.declaration?.id) exportsOf[f].add(n.declaration.id.name); n.specifiers?.forEach(s=>exportsOf[f].add(s.exported.name)) } if(n.type==='ExportDefaultDeclaration') exportsOf[f].add('default') }
  ast._src=src; exportsOf[f+'#ast']=ast
}
for(const f of files){ const ast=exportsOf[f+'#ast']; if(!ast) continue
  for(const n of ast.program.body){ if(n.type!=='ImportDeclaration'||!n.source.value.startsWith('.')) continue
    const target=path.resolve(path.dirname(f),n.source.value)
    if(!fs.existsSync(target)){ console.log('MISSING FILE',path.relative(root,f),'->',n.source.value); bad++; continue }
    for(const s of n.specifiers){ const name=s.type==='ImportSpecifier'?s.imported.name:s.type==='ImportDefaultSpecifier'?'default':null
      if(name&&!exportsOf[target]?.has(name)){ console.log('MISSING EXPORT',name,'in',n.source.value,'(imported by',path.relative(root,f)+')'); bad++ } } } }
console.log(files.length,'files parsed; problems:',bad)
process.exit(bad ? 1 : 0)
