// QA: every Mongoose ref resolves to a registered model, and every populate() path in the KB API is a real ref
process.env.JWT_SECRET='x'; process.env.MONGO_URI='x'
import { fileURLToPath, pathToFileURL } from 'url'
import nodePath from 'path'
// portable: everything is resolved relative to this file, and dynamic import()
// gets a file:// URL (a bare absolute path breaks on Windows)
const ROOT = nodePath.resolve(nodePath.dirname(fileURLToPath(import.meta.url)), '..')
const load = (p) => import(pathToFileURL(p).href)
import fs from 'fs'
const B=(ROOT+'/backend/')
const mongoose=(await load(B+'node_modules/mongoose/index.js')).default
for(const f of fs.readdirSync(B+'models')) await load(B+'models/'+f)
const names=new Set(mongoose.modelNames()); console.log('models:',[...names].join(', '))
let bad=0, refs=0
const walk=(schema,label,prefix='')=>{ schema.eachPath((p,t)=>{
  const ref=t.options?.ref ?? t.caster?.options?.ref
  if(ref){ refs++; if(!names.has(ref)){ console.log(`BAD REF  ${label}.${prefix}${p} -> '${ref}'`); bad++ } }
  if(t.schema) walk(t.schema,label,prefix+p+'.') }) }
for(const n of names) walk(mongoose.model(n).schema,n)
console.log(`${refs} refs checked, unresolved: ${bad}`)
// every populate() path used in routes must be a real ref path on that model
const api=fs.readFileSync(B+'APIs/KnowledgeBaseAPI.js','utf8')
const K=mongoose.model('knowledgearticle')
for(const m of api.matchAll(/\.populate\('([\w.]+)'/g)){ const t=K.schema.path(m[1]); const ok=t&&(t.options?.ref||t.caster?.options?.ref); console.log(`  populate('${m[1]}') ->`, ok?'ok (ref '+ok+')':'NOT A REF'); if(!ok) bad++ }
process.exit(bad?1:0)

