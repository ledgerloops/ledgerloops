import {Schema, Table, column} from '@powersync/node';
export const variants=['typed','record_json','collection_json'];
export const nested={issues:new Set(['user','assignees','labels','repository','comments','milestone']),notes:new Set(['labels','checklist','attachments','reminder','collaborators'])};
export const bools=new Set(['archived','pinned']);
export function definitions(fixture,variant){
 if(variant==='collection_json')return {collections:{id:'text',data:'json'}};
 return Object.fromEntries(Object.entries(fixture).map(([t,rows])=>[t,variant==='record_json'?{id:'text',data:'json'}:Object.fromEntries(Object.keys(rows[0]).map(k=>[k,k==='number'?'integer':bools.has(k)?'boolean':nested[t].has(k)?'json':'text']))]));
}
export function clientSchema(fixture,variant){return new Schema(Object.fromEntries(Object.entries(definitions(fixture,variant)).map(([t,cols])=>[t,new Table(Object.fromEntries(Object.entries(cols).filter(([k])=>k!=='id').map(([k,type])=>[k,['integer','boolean'].includes(type)?column.integer:column.text])))])));}
export const quote=x=>'"'+x.replaceAll('"','""')+'"';
export async function setupSource(pg,fixture,variant){
 const defs=definitions(fixture,variant);
 for(const [table,cols] of Object.entries(defs)){
  await pg.query(`CREATE TABLE ${quote(table)} (${Object.entries(cols).map(([k,t])=>`${quote(k)} ${t}${k==='id'?' PRIMARY KEY':''}`).join(',')})`);
  const rows=variant==='collection_json'?Object.entries(fixture).map(([id,data])=>({id,data})):fixture[table].map(row=>variant==='record_json'?{id:row.id,data:row}:row);
  for(const row of rows){const keys=Object.keys(cols);await pg.query(`INSERT INTO ${quote(table)} (${keys.map(quote)}) VALUES (${keys.map((_,i)=>'$'+(i+1))})`,keys.map(k=>cols[k]==='json'?JSON.stringify(row[k]):row[k]));}
  await pg.query(`ALTER TABLE ${quote(table)} REPLICA IDENTITY FULL`);
 }
 await pg.query('CREATE PUBLICATION powersync FOR ALL TABLES');
}
export function syncConfig(fixture,variant){
 return `config:\n  edition: 3\nstreams:\n  benchmark:\n    auto_subscribe: false\n    queries:\n`+Object.keys(definitions(fixture,variant)).map(t=>`      - SELECT * FROM ${quote(t)} WHERE auth.user_id() = 'synthetic-benchmark-user'\n`).join('');
}
export async function reconstruct(db,variant){
 if(variant==='collection_json')return Object.fromEntries((await db.getAll('SELECT * FROM collections ORDER BY id')).map(r=>[r.id,JSON.parse(r.data)]));
 const out={};for(const t of ['issues','notes']){const rows=await db.getAll(`SELECT * FROM ${quote(t)} ORDER BY id`);out[t]=variant==='record_json'?rows.map(r=>JSON.parse(r.data)):rows.map(r=>Object.fromEntries(Object.entries(r).map(([k,v])=>[k,nested[t].has(k)&&v!==null?JSON.parse(v):bools.has(k)?!!v:v])));}
 return out;
}
export async function changeField(pg,fixture,variant,table,field,value){
 const original=fixture[table][0];
 if(variant==='typed')await pg.query(`UPDATE ${quote(table)} SET ${quote(field)}=$1 WHERE id=$2`,[value,original.id]);
 else if(variant==='record_json')await pg.query(`UPDATE ${quote(table)} SET data=$1 WHERE id=$2`,[JSON.stringify({...original,[field]:value}),original.id]);
 else {const rows=structuredClone(fixture[table]);rows[0][field]=value;await pg.query('UPDATE collections SET data=$1 WHERE id=$2',[JSON.stringify(rows),table]);}
}
export function canonical(x){if(Array.isArray(x))return '['+x.map(canonical).join(',')+']';if(x!==null&&typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';return JSON.stringify(x);}
