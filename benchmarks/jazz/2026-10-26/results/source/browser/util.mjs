import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { canonical } from './model.mjs';

export const sha = value => createHash('sha256').update(canonical(value)).digest('hex');
export const now = () => performance.now();
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function bounded(promise, label, ms=120000) {
  let timer;
  return Promise.race([promise, new Promise((_,reject) => { timer = setTimeout(() => reject(new Error(`Timeout ${label} after ${ms}ms`)),ms); })]).finally(() => clearTimeout(timer));
}
export async function disk(root) {
  const files=[];
  async function walk(dir) {
    let names;
    try { names = await fs.readdir(dir); } catch (e) { if (e.code==='ENOENT') return; throw e; }
    for (const name of names) {
      const p=path.join(dir,name), stat=await fs.lstat(p);
      if (stat.isDirectory()) await walk(p);
      else if (stat.isFile()) files.push({ path:path.relative(root,p), apparent:stat.size, allocated:stat.blocks*512 });
    }
  }
  await walk(root);
  return { apparent: files.reduce((n,f)=>n+f.apparent,0), allocated:files.reduce((n,f)=>n+f.allocated,0), files };
}
export const netDisk = (total, baseline) => ({ apparent:total.apparent-baseline.apparent, allocated:total.allocated-baseline.allocated });
export function fileAccountStore(file) {
  return {
    async read() { try { return await fs.readFile(file,'utf8'); } catch(e) { if(e.code==='ENOENT') return null; throw e; } },
    async update(transform) {
      let before = await this.read();
      const next=transform(before);
      if (next===null) await fs.rm(file,{force:true});
      else { await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,next,{mode:0o600}); }
    },
  };
}
export async function readTables(db, app, tables, tier='local-first') {
  return Object.fromEntries(await Promise.all(tables.map(async name => [name, await db.all(app[name],{tier})])));
}
export function observer(db, app, tables, mode, decode) {
  let results={}, waiter, latest, fatal;
  const unsubscribers=[];
  const update = () => {
    try { latest = decode(mode,results); } catch { return; }
    if (waiter && sha(latest)===waiter.expected) { const w=waiter; waiter=null; w.resolve({ observed_at:now(), hash:w.expected }); }
  };
  return {
    start() {
      for (const name of tables) unsubscribers.push(db.subscribe(app[name],{
        onUpdate(rows) { results[name]=rows; update(); },
        onError(error) { fatal=error; waiter?.reject(error); },
      },{tier:'remote'}));
    },
    wait(expected) {
      if (fatal) return Promise.reject(fatal);
      if (latest && sha(latest)===expected) return Promise.resolve({observed_at:now(),hash:expected});
      return bounded(new Promise((resolve,reject)=>{waiter={expected,resolve,reject};}),'complete fixture subscription').catch(error=>{
        error.message += '; tables='+JSON.stringify(Object.fromEntries(Object.entries(results).map(([name,rows])=>[name,rows.length])))+'; last_hash='+(latest?sha(latest):'unavailable')+'; expected='+expected;
        throw error;
      });
    },
    stop() { for(const unsubscribe of unsubscribers) unsubscribe(); },
  };
}
