import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID,createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startLocalJazzServer, deploy } from 'jazz-tools/dev';
import { createJazzSession } from 'jazz-tools/backend';
import { makeModel, encodeModel, decodeModel, canonical, mutationFor } from './model.mjs';
import { wireProxy } from './wire.mjs';
import { sha, now, sleep, bounded, disk, netDisk, fileAccountStore, readTables, observer } from './util.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../..');
const lock=path.join(process.env.HOME, 'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock/owner.json');
const owner=JSON.parse(await fs.readFile(lock,'utf8'));
if(owner.engine!=='jazz' || owner.pid!==process.ppid) throw new Error('Run via python3 locked.py node run.mjs');
const runName=process.env.JAZZ_RUN_NAME??new Date().toISOString().replaceAll(':','-');
const storeRoot=path.join(process.env.JAZZ_DATA_ROOT??'/private/tmp/sync-benchmark-jazz-20261026-runtime/stores',runName);await fs.mkdir(storeRoot,{recursive:true});
const resultsDir=path.join(here,'results',runName);await fs.mkdir(resultsDir,{recursive:true});
const fixture=JSON.parse(await fs.readFile(path.join(here,'fixture/fixture.json'),'utf8'));
const expectedHash='9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a';
if(sha(fixture)!==expectedHash || Buffer.byteLength(canonical(fixture))!==415448) throw new Error('Fixture manifest mismatch');
const warmups=Number(process.env.JAZZ_WARMUPS??3), repetitions=Number(process.env.JAZZ_REPETITIONS??10);
const runtimes=(process.env.JAZZ_RUNTIMES??'native,browser').split(',');
const modes=(process.env.JAZZ_MODELS??'embedded,containers,collections').split(',');
const timeout=fn=>bounded(fn,'engine operation');
const command=(bin,args)=>{try{return execFileSync(bin,args,{encoding:'utf8'}).trim();}catch{return null;}};
const environment={utc:new Date().toISOString(),node:process.version,npm:command('npm',['--version']),os:command('sw_vers',[]),
  kernel:command('uname',['-srv']),architecture:process.arch,cpu:command('sysctl',['-n','machdep.cpu.brand_string']),
  logical_cpu_count:command('sysctl',['-n','hw.logicalcpu']),ram_bytes:command('sysctl',['-n','hw.memsize']),
  filesystem:command('df',['-h',storeRoot]),storage_path:storeRoot,container:null,cgroup_limit:null,
  filesystem_type:'APFS on internal solid-state Apple Fabric storage (diskutil info /System/Volumes/Data)',
  cpu_quota:null,ram_quota:null,
  versions:{'jazz-tools':'2.0.0-alpha.59','jazz-napi':'2.0.0-alpha.59',playwright:'1.56.1'},
  contention:'All worker heavy work serialized by atomic mkdir lock; six chats share laptop, OS/user/background activity and thermal state uncontrolled.',
  lock_owner:owner,models:modes,runtimes,warmups,repetitions};
environment.persistence={native:'Pinned NAPI RocksDB WalNoSync; synchronous flush_wal(true) on storage close; normal batching defaults',
  browser:'IndexedDB SharedWorker page store, readwrite durability relaxed; initialSyncFlushEvery default 512',
  native_initial_sync_batching:'Node user runtime passes no initialSyncFlushEvery override; core cadence None, storage WAL sync cadence 64 write batches',
  indexes:'Engine default schema/history/current-state/metadata indexes; no extra application indexes; no manual compaction',
  identity:'Fresh synthetic local-first user accounts, ordinary Core permission checks; explicit allow policies for synthetic app',
  encryption:'Ordinary local HTTP/WebSocket, no TLS, no optional application encryption; default identity/integrity checks retained'};
environment.adapter_source_sha256={};
await fs.mkdir(path.join(resultsDir,'source'),{recursive:true});
for(const name of ['run.mjs','model.mjs','wire.mjs','util.mjs','browser.mjs','browser-runner.mjs','package-lock.json']) {
  const content=await fs.readFile(path.join(here,name));
  environment.adapter_source_sha256[name]=createHash('sha256').update(content).digest('hex');
  await fs.writeFile(path.join(resultsDir,'source',name),content);
}
await fs.writeFile(path.join(resultsDir,'environment.json'),JSON.stringify(environment,null,2)+'\n');

async function nativeOpen(config,dir,offline=false) {
  await fs.mkdir(dir,{recursive:true});
  const session=await timeout(createJazzSession({appId:config.appId,app:config.app,permissions:config.permissions,serverUrl:config.serverUrl,
    driver:{type:'persistent',dataPath:path.join(dir,'data')},store:fileAccountStore(path.join(dir,'account.json')),initial:'local-first'}));
  const snap=session.getSnapshot();if(!snap.client)throw snap.error??new Error(snap.status);
  const db=snap.client.db;
  if(offline) await db.disconnect();
  else await timeout(db.all(config.app.ready,{tier:'remote'}));
  return {session,db};
}

async function seed(db,app,encoded) {
  const ids={};
  // Bounded batches, default durability/integrity, every write accepted by Core.
  for(const [table,rows]of Object.entries(encoded)) {
    ids[table]=[];
    for(let i=0;i<rows.length;i+=16) {
      const writes=rows.slice(i,i+16).map(row=>db.insert(app[table],row));
      ids[table].push(...writes.map(w=>w.value.id));
      await timeout(Promise.all(writes.map(w=>w.wait({tier:'global'}))));
    }
  }
  return ids;
}

async function incrementals({writer,model,encoded,ids,mode,observe,proxy}) {
  const records=[];
  const updated=structuredClone(fixture);
  for(let rep=0;rep<repetitions;rep++) {
    for(const [collection,field,value] of [['issues','title',fixture.issues[0].title+` [benchmark-title-${rep}]`],['notes','body',fixture.notes[0].body+` [benchmark-body-${rep}]`]]) {
      const before=updated[collection][0][field];updated[collection][0][field]=value;
      const mutation=mutationFor(mode,encoded,ids,collection,0,field,value);
      const oldBytes=Buffer.from(before),newBytes=Buffer.from(value);let prefix=0,suffix=0;
      while(prefix<Math.min(oldBytes.length,newBytes.length)&&oldBytes[prefix]===newBytes[prefix])prefix++;
      while(suffix<Math.min(oldBytes.length,newBytes.length)-prefix&&oldBytes[oldBytes.length-1-suffix]===newBytes[newBytes.length-1-suffix])suffix++;
      console.log('INCREMENTAL_OPERATION',mode,rep,field);
      proxy.reset(); const expected=sha(updated); const convergence=observe.wait(expected); const t0=now();
      const write=writer.db.update(model.app[mutation.table],mutation.id,mutation.patch);
      const accepted=timeout(write.wait({tier:'global'})).then(()=>now()-t0);
      let got,globalMs;
      try { [got,globalMs]=await Promise.all([convergence,accepted]); }
      catch(error) {
        error.completed=records;error.operation={repetition:rep,collection,field,elapsed_ms:now()-t0,wire:proxy.counts(),expected_hash:expected};throw error;
      }
      const wire=proxy.counts();
      records.push({repetition:rep,collection,field,logical_old_value_bytes:Buffer.byteLength(before),logical_new_value_bytes:Buffer.byteLength(value),
        changed_bytes_removed:oldBytes.length-prefix-suffix,changed_bytes_inserted:newBytes.length-prefix-suffix,
        replacement_api_patch_bytes:Buffer.byteLength(canonical(mutation.patch)),observable_ms:got.observed_at-t0,sender_global_confirmation_ms:globalMs,
        durable_ms:null,durability_note:'Receiver incoming-update durability has no separate public receipt; observable convergence only.',wire,verified_hash:expected});
    }
  }
  return records;
}

async function nativeTransfers({model,mode,server,writer,encoded,ids,variantRoot}) {
  const rows=[];
  for(let run=0;run<warmups+repetitions;run++) {
    const dir=path.join(variantRoot,'receivers',String(run));const proxy=await wireProxy(server.port);
    const config={...model,appId:server.appId,serverUrl:proxy.url};
    let receiver,obs;
    try {
      receiver=await nativeOpen(config,dir);await receiver.session.close();
      const baseline=await disk(dir);
      const connectStart=now();receiver=await nativeOpen(config,dir);const connectMs=now()-connectStart;
      await sleep(20);proxy.reset();
      obs=observer(receiver.db,model.app,model.tables,mode,decodeModel);
      const done=obs.wait(expectedHash),t0=now();obs.start();const got=await done;
      const wire=proxy.counts();obs.stop();
      await timeout(receiver.session.close());const closeDone=now();
      console.log('INITIAL_CLOSED',mode,run,got.observed_at-t0);
      const total=await disk(dir);
      proxy.offline();const reopenStart=now();receiver=await nativeOpen(config,dir,true);
      const actual=decodeModel(mode,await readTables(receiver.db,model.app,model.tables));
      if(sha(actual)!==expectedHash)throw new Error('Native offline reopen mismatch');
      const reopenMs=now()-reopenStart;
      const record={runtime:'native',model:mode,run,warmup:run<warmups,connection_auth_open_ms:connectMs,
        observable_ms:got.observed_at-t0,durable_ms:closeDone-t0,
        durability_boundary:'Conservative upper bound: awaited native session.close, including subscription teardown/transport shutdown; RocksDB storage close synchronously flushes WAL.',
        wire,wire_at_close:proxy.counts(),receiver_storage:{baseline,total,net:netDisk(total,baseline)},
        reopen:{offline_proxy_blocked:true,verified_hash:sha(actual),bytes:Buffer.byteLength(canonical(actual)),elapsed_ms:reopenMs}};
      if(run===warmups+repetitions-1) {
        try {
          proxy.offline(false);await receiver.db.reconnect();await timeout(receiver.db.all(model.app.ready,{tier:'remote'}));
          obs=observer(receiver.db,model.app,model.tables,mode,decodeModel);obs.start();await obs.wait(expectedHash);
          console.log('INCREMENTALS_START',mode);
          record.incrementals=await incrementals({writer,model,encoded,ids,mode,observe:obs,proxy});obs.stop();
        } catch(error) { record.incrementals=error.completed??[];record.incremental_error={message:error.message,stack:error.stack,operation:error.operation};console.error('INCREMENTAL_BLOCKED',mode,error); }
      }
      await receiver.session.close();receiver=null;
      if(record.incrementals?.length) {
        proxy.offline();receiver=await nativeOpen(config,dir,true);
        const changed=decodeModel(mode,await readTables(receiver.db,model.app,model.tables));
        const expected=record.incrementals.at(-1).verified_hash;
        if(sha(changed)!==expected)throw new Error('Native changed fixture offline reopen mismatch');
        record.incrementals_final_reopen={verified_hash:expected,offline_proxy_blocked:true};
        await receiver.session.close();receiver=null;
      }
      rows.push(record);
      await fs.writeFile(path.join(resultsDir,`native-${mode}.json`),JSON.stringify(rows,null,2)+'\n');
      console.log(JSON.stringify({runtime:'native',mode,run,warmup:record.warmup,observable_ms:record.observable_ms,durable_ms:record.durable_ms,wire:wire.received_ws_payload_bytes}));
    } finally {obs?.stop();if(receiver)await receiver.session.close().catch(()=>{});await proxy.close();}
  }
  return rows;
}

let vite,browserRuntime;
async function browserTransfers(args) {
  const { browserTransfers:run }=await import('./browser-runner.mjs');
  return run({...args,root,here,resultsDir,fixture,expectedHash,warmups,repetitions,incrementals,nativeOpen,timeout});
}
const all=[];
for(const runtime of runtimes)for(const mode of modes) {
  const variantRoot=path.join(storeRoot,`${runtime}-${mode}`);await fs.mkdir(variantRoot,{recursive:true});
  const model=makeModel(mode),encoded=encodeModel(mode,fixture);const prepStart=now();
  let server,writer;
  try {
    server=await timeout(startLocalJazzServer({host:'127.0.0.1',appId:randomUUID(),dataDir:path.join(variantRoot,'server'),schema:model.app,permissions:model.permissions,allowLocalFirstAuth:true}));
    await timeout(deploy({...server,schema:model.app,permissions:model.permissions,serverUrl:server.url}));
    writer=await nativeOpen({...model,appId:server.appId,serverUrl:server.url},path.join(variantRoot,'sender'));
    const ids=await seed(writer.db,model.app,encoded);const prepMs=now()-prepStart;
    console.log('PREPARED',runtime,mode,Object.fromEntries(Object.entries(encoded).map(([k,v])=>[k,v.length])),prepMs);
    const transfers=await (runtime==='native'?nativeTransfers:browserTransfers)({model,mode,server,writer,encoded,ids,variantRoot});
    await writer.session.close();writer=null;await server.stop();server=null;
    const variant={runtime,model:mode,preparation_ms:prepMs,row_counts:Object.fromEntries(Object.entries(encoded).map(([k,v])=>[k,v.length])),
      sender_storage:await disk(path.join(variantRoot,'sender')),required_service_storage:await disk(path.join(variantRoot,'server')),transfers};
    all.push(variant);
  } catch(error) {
    console.error('VARIANT_BLOCKED',runtime,mode,error);
    all.push({runtime,model:mode,status:'blocked',error:{message:error.message,stack:error.stack}});
  } finally { if(writer)await writer.session.close().catch(()=>{});if(server)await server.stop().catch(()=>{}); }
  await fs.writeFile(path.join(resultsDir,'results.json'),JSON.stringify({environment,variants:all},null,2)+'\n');
}
console.log('RESULTS',resultsDir);
