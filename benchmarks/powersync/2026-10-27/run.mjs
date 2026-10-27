import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PowerSyncDatabase,SyncStreamConnectionMethod} from '@powersync/node';
import {Client} from 'pg';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {variants,clientSchema,setupSource,syncConfig,reconstruct,changeField,canonical} from './models.mjs';
import {wireProxy,diffWire} from './wire.mjs';
import {diskTree,diskDelta} from './storage.mjs';
// Loopback-only benchmark traffic must not inherit a configured external proxy.
for(const key of ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy'])delete process.env[key];
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const lockPath=path.join(process.env.BENCH_LOCK_PATH || path.join(os.homedir(),'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock'),'owner.json');
const lock=JSON.parse(fs.readFileSync(lockPath));
if(lock.engine!=='powersync'||lock.pid!==process.ppid)throw Error('Run through with_measurement_lock.py');
const runId=new Date().toISOString().replaceAll(/[:.]/g,'-');
const scratch=path.join(process.env.BENCH_WORKDIR || path.join(os.tmpdir(),'powersync-synthetic-benchmark'),runId);fs.mkdirSync(scratch,{recursive:true});
const resultDir=path.join(here,'results',runId);fs.mkdirSync(resultDir,{recursive:true});
const fixture=JSON.parse(fs.readFileSync(path.join(here,'fixture/fixture.json')));
const manifest=JSON.parse(fs.readFileSync(path.join(here,'fixture/manifest.json')));
const hash=x=>crypto.createHash('sha256').update(canonical(x)).digest('hex');
if(hash(fixture)!==manifest.sha256)throw Error('Fixture manifest mismatch');
const expectedOriginal=hash(fixture);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const now=()=>performance.now();
const json=(p,x)=>fs.writeFileSync(p,JSON.stringify(x,null,2)+'\n');
async function bounded(p,label,ms=60000){let t;try{return await Promise.race([p,new Promise((_,rej)=>t=setTimeout(()=>rej(Error('Timeout: '+label)),ms))]);}finally{clearTimeout(t);}}
function shell(cmd,args=[]){return execFileSync(cmd,args,{encoding:'utf8'}).trim();}
const selected=process.env.BENCH_VARIANTS?process.env.BENCH_VARIANTS.split(','):variants;
const warmups=process.env.BENCH_WARMUPS===undefined?3:Number(process.env.BENCH_WARMUPS);
const measured=process.env.BENCH_REPS===undefined?10:Number(process.env.BENCH_REPS);
const environment={utc:new Date().toISOString(),os:os.type(),osVersion:shell('sw_vers'),quota:null,cgroupLimit:null,browser:null,kernel:os.release(),architecture:os.arch(),cpu:os.cpus()[0].model,vcpus:os.cpus().length,ramBytes:os.totalmem(),runtime:process.versions,postgres:shell('postgres',['--version']),filesystem:shell('df',['-k',scratch]),storagePath:scratch,container:null,lockOwner:lock,warmups,measured,variants:selected,nodeDefaultWorkers:'1 writer + 5 readers',durability:'default SDK/SQLite settings; observed pragmas recorded per run',indexes:'SDK default id keys and metadata indexes; no application secondary indexes',contention:'All sustained setup and runs use shared mkdir lock; other workers may perform documentation/network work; OS background activity uncontrolled',fixture:manifest};
json(path.join(resultDir,'environment.json'),environment);
// issue-42.md is the frozen contract shipped alongside this runner.
const allResults=[];const failures=[];const heldSubscriptions=[];
function save(){json(path.join(resultDir,'raw.json'),{runId,environment,results:allResults,failures});}
async function freePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return p;}
async function tokenAndKey(){const {privateKey,publicKey}=await generateKeyPair('RS256',{modulusLength:2048});const jwk=await exportJWK(publicKey);Object.assign(jwk,{kid:'synthetic-key',alg:'RS256',use:'sig'});const token=await new SignJWT({}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setSubject('synthetic-benchmark-user').setAudience('powersync-synthetic-benchmark').setIssuedAt().setExpirationTime('4h').sign(privateKey);return {jwk,token};}
function openDB(dir,variant){fs.mkdirSync(dir,{recursive:true});return new PowerSyncDatabase({schema:clientSchema(fixture,variant),database:{dbFilename:'receiver.sqlite',dbLocation:dir}});}
async function verify(db,variant,expected,label){const data=await reconstruct(db,variant);const actual=hash(data);if(actual!==expected)throw Error(`${label}: hash mismatch ${actual} expected ${expected}`);return {sha256:actual,issues:data.issues.length,notes:data.notes.length,canonicalBytes:Buffer.byteLength(canonical(data))};}
async function observe(db,variant,expected){const end=now()+60000;let attempts=0;while(now()<end){attempts++;try{const counts=variant==='collection_json'?await db.get('SELECT count(*) AS n FROM collections'):await db.get('SELECT (SELECT count(*) FROM issues)+(SELECT count(*) FROM notes) AS n');if(counts.n===(variant==='collection_json'?2:132)){const data=await reconstruct(db,variant);if(hash(data)===expected)return {at:now(),attempts};}}catch(e){if(!/no such table/.test(e.message))throw e;}await sleep(2);}throw Error('Timeout waiting for complete fixture visibility');}
async function settle(db){const request=await bounded(db.requestCheckpoint(),'request checkpoint');await bounded(request.waitForSync(),'checkpoint source position');}
function connector(port,token){return {async fetchCredentials(){return {endpoint:`http://127.0.0.1:${port}`,token};}};}
const options={connectionMethod:SyncStreamConnectionMethod.WEB_SOCKET,checkpointMode:'requests',includeDefaultStreams:false};
async function serviceSizes(pg){const rows=(await pg.query("SELECT datname,pg_database_size(oid)::bigint AS bytes FROM pg_database WHERE datname IN ('source','buckets') ORDER BY datname")).rows;return Object.fromEntries(rows.map(x=>[x.datname,Number(x.bytes)]));}
for(const variant of selected){
 if(!variants.includes(variant))throw Error('Unknown variant '+variant);
 const dir=path.join(scratch,variant);fs.mkdirSync(dir,{recursive:true});
 let service=null,pgStarted=false,admin=null,source=null,prep=null,prepProxy=null;const openDatabases=new Set();const proxies=new Set();
 const pgDir=path.join(dir,'postgres');const pgPort=await freePort();const servicePort=await freePort();
 const begin=now();
 try{
  const passwordFile=path.join(dir,'synthetic-password.txt');fs.writeFileSync(passwordFile,'synthetic-only-password\n',{mode:0o600});
  shell('initdb',['-D',pgDir,'-U','synthetic_admin','-A','scram-sha-256','--pwfile',passwordFile,'--no-locale','-E','UTF8']);
  fs.appendFileSync(path.join(pgDir,'postgresql.conf'),`\nlisten_addresses='127.0.0.1'\nport=${pgPort}\nwal_level=logical\nmax_replication_slots=10\nmax_wal_senders=10\nunix_socket_directories='' \n`);
  shell('pg_ctl',['-D',pgDir,'-l',path.join(dir,'postgres.log'),'-w','start']);pgStarted=true;
  admin=new Client({host:'127.0.0.1',port:pgPort,user:'synthetic_admin',password:'synthetic-only-password',database:'postgres'});await admin.connect();
  await admin.query('CREATE DATABASE source');await admin.query('CREATE DATABASE buckets');
  const logicalBaseline=await serviceSizes(admin);const clusterBaseline=diskTree(pgDir);
  source=new Client({host:'127.0.0.1',port:pgPort,user:'synthetic_admin',password:'synthetic-only-password',database:'source'});await source.connect();
  await setupSource(source,fixture,variant);
  const {jwk,token}=await tokenAndKey();
  fs.writeFileSync(path.join(dir,'sync-config.yaml'),syncConfig(fixture,variant));
  const conf={replication:{connections:[{type:'postgresql',uri:`postgresql://synthetic_admin:synthetic-only-password@127.0.0.1:${pgPort}/source`,sslmode:'disable'}]},storage:{type:'postgresql',uri:`postgresql://synthetic_admin:synthetic-only-password@127.0.0.1:${pgPort}/buckets`,sslmode:'disable'},port:servicePort,sync_config:{path:path.join(dir,'sync-config.yaml')},client_auth:{jwks:{keys:[jwk]},audience:['powersync-synthetic-benchmark']},telemetry:{disable_telemetry_sharing:true},api:{tokens:['synthetic-admin-token']}};
  // JSON is valid YAML. No keys or tokens from the user's environment are used.
  json(path.join(dir,'powersync.yaml'),conf);
  const serviceLog=fs.openSync(path.join(dir,'service.log'),'a');
  service=spawn(process.execPath,[path.join(here,'node_modules/@powersync/service-image/lib/entry.js'),'start','-r','unified','-c',path.join(dir,'powersync.yaml')],{cwd:dir,env:{...process.env,SENTRY_DSN:'',PS_LOG_LEVEL:'warn'},stdio:['ignore',serviceLog,serviceLog]});fs.closeSync(serviceLog);
  let ready=false;for(let i=0;i<300;i++){if(service.exitCode!==null)throw Error('Service exited '+service.exitCode+'; see '+path.join(dir,'service.log'));try{const r=await fetch(`http://127.0.0.1:${servicePort}/probes/readiness`);if(r.ok){ready=true;break;}}catch{}await sleep(200);}if(!ready)throw Error('Service readiness timeout');
  const schema=syncConfig(fixture,variant);fs.writeFileSync(path.join(resultDir,variant+'-sync-config.yaml'),schema);
  prepProxy=await wireProxy(servicePort);proxies.add(prepProxy);prep=openDB(path.join(dir,'sender-readiness-client'),variant);openDatabases.add(prep);await prep.init();await prep.connect(connector(prepProxy.port,token),options);const prepSub=await prep.syncStream('benchmark').subscribe();heldSubscriptions.push(prepSub);await bounded(prepSub.waitForFirstSync(),'sender snapshot');await settle(prep);await verify(prep,variant,expectedOriginal,'sender prepared');await prep.disconnect();
  const setupMs=now()-begin;
  const preparedLogical=await serviceSizes(admin);await admin.query('CHECKPOINT');const preparedDisk=diskTree(pgDir);
  const sourceSettings=(await source.query("SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','wal_level','max_wal_senders','max_replication_slots')")).rows;
  const serviceRecord={variant,setupMs,pgPort,servicePort,sourceSettings,logicalBytes:{baseline:logicalBaseline,prepared:preparedLogical,preparedNet:Object.fromEntries(Object.keys(logicalBaseline).map(k=>[k,preparedLogical[k]-logicalBaseline[k]]))},physicalCluster:diskDelta(clusterBaseline,preparedDisk),note:'One native Postgres cluster contains separate source and bucket databases. Physical totals include shared catalog/WAL; logical database sizes split source and service buckets. Executables/dependencies and SDK readiness receiver excluded.'};
  json(path.join(resultDir,variant+'-service-storage.json'),serviceRecord);
  for(let i=-warmups;i<measured;i++){
   const phase=i<0?'warmup':'measured';const ordinal=i<0?i+warmups:i;
   // Keep the prepared sender unchanged throughout all initial-sync repetitions.
   await prep.connect(connector(prepProxy.port,token),options);await settle(prep);await verify(prep,variant,expectedOriginal,'sender reset checkpoint');await prep.disconnect();
   const receiverDir=path.join(dir,phase+'-'+ordinal);let db=openDB(receiverDir,variant);openDatabases.add(db);const receiverStart=now();await db.init();await db.close();openDatabases.delete(db);const baseline=diskTree(receiverDir);db=openDB(receiverDir,variant);openDatabases.add(db);await db.init();
   const pragmas=await db.writeLock(async tx=>({journal_mode:await tx.get('PRAGMA journal_mode'),synchronous:await tx.get('PRAGMA synchronous'),fullfsync:await tx.get('PRAGMA fullfsync'),checkpoint_fullfsync:await tx.get('PRAGMA checkpoint_fullfsync'),sqlite_version:await tx.get('SELECT sqlite_version() AS version'),powersync_version:await tx.get('SELECT powersync_rs_version() AS version')}));
   const proxy=await wireProxy(servicePort);proxies.add(proxy);const connectionStart=now();await db.connect(connector(proxy.port,token),options);await bounded(db.waitForFirstSync(),'empty authenticated sync');await settle(db);const connectionMs=now()-connectionStart;
   if(hash(await reconstruct(db,variant))===expectedOriginal)throw Error('Dataset arrived before subscription');
   const preWire=proxy.snapshot();const t0=now();const subP=db.syncStream('benchmark').subscribe();const observable=observe(db,variant,expectedOriginal);const sub=await subP;heldSubscriptions.push(sub);await bounded(sub.waitForFirstSync(),'full dataset subscription checkpoint');const checkpointMs=now()-t0;const read=await observable;const endWire=proxy.snapshot();
   const initialVerification=await verify(db,variant,expectedOriginal,'initial complete');
   await db.disconnect();await db.close();openDatabases.delete(db);const total=diskTree(receiverDir);
   db=openDB(receiverDir,variant);openDatabases.add(db);await db.init();const reopened=await verify(db,variant,expectedOriginal,'initial reopened');
   const row={variant,phase,ordinal,utc:new Date().toISOString(),receiverInitializationMs:connectionStart-receiverStart,connectionAuthenticationEmptyCheckpointMs:connectionMs,observableMs:read.at-t0,checkpointAppliedMs:checkpointMs,durableMs:null,durabilityEvidence:'SDK full stream checkpoint applied; no power-loss durability acknowledgement. Default SQLite synchronous/fullfsync recorded; full content verified after close/reopen outside timer.',strictEstablishedTransportOnlyMs:endWire.websocketUpgrades>preWire.websocketUpgrades?null:checkpointMs,subscriptionTriggeredNewWebsocket:endWire.websocketUpgrades>preWire.websocketUpgrades,wire:{...diffWire(preWire,endWire),...await proxy.decodeWindow(preWire,endWire)},transport:proxy.counter.responseHeaders,pragmas,storage:diskDelta(baseline,total),verification:{initial:initialVerification,reopened},incremental:[]};
   if(i===measured-1){
   // Ten incremental pairs follow all initial transfers, on this subscribed receiver.
   await db.connect(connector(proxy.port,token),options);await settle(db);
   for(let updateOrdinal=0;updateOrdinal<10;updateOrdinal++){
   if(updateOrdinal>0){await changeField(source,fixture,variant,'issues','title',fixture.issues[0].title);await changeField(source,fixture,variant,'notes','body',fixture.notes[0].body);await settle(db);await verify(db,variant,expectedOriginal,'incremental reset');}
   const modified=structuredClone(fixture);
   for(const [table,field] of [['issues','title'],['notes','body']]){
    const value=fixture[table][0][field]+' [synthetic update]';modified[table][0][field]=value;const expected=hash(modified);const before=proxy.snapshot();const start=now();const seen=observe(db,variant,expected);await changeField(source,fixture,variant,table,field,value);const sourceCommitMs=now()-start;await settle(db);const appliedMs=now()-start;const visible=await seen;const after=proxy.snapshot();const checked=await verify(db,variant,expected,'incremental '+field);
    row.incremental.push({ordinal:updateOrdinal,table,field,sourceChangedUtf8Bytes:Buffer.byteLength(value),sourceDeltaUtf8Bytes:Buffer.byteLength(value)-Buffer.byteLength(fixture[table][0][field]),sourceCommitMs,observableMs:visible.at-start,checkpointAppliedMs:appliedMs,durableMs:null,wire:{...diffWire(before,after),...await proxy.decodeWindow(before,after)},verification:checked});
   }
   await db.disconnect();await db.close();openDatabases.delete(db);db=openDB(receiverDir,variant);openDatabases.add(db);await db.init();row.verification.incrementalReopened=await verify(db,variant,hash(modified),'incremental reopened');
   if(updateOrdinal<9){await db.connect(connector(proxy.port,token),options);await settle(db);}
   }
   }
   await db.close();openDatabases.delete(db);await proxy.close();proxies.delete(proxy);
   allResults.push(row);save();console.log(JSON.stringify({variant,phase,ordinal,checkpointMs,observableMs:row.observableMs,wire:row.wire,verified:true}));
  }
  serviceRecord.logicalBytes.final=await serviceSizes(admin);await admin.query('CHECKPOINT');serviceRecord.finalPhysicalCluster=diskTree(pgDir);json(path.join(resultDir,variant+'-service-storage.json'),serviceRecord);
 }catch(e){failures.push({variant,error:String(e),stack:e.stack,scratch:dir,postgresLog:fs.existsSync(path.join(dir,'postgres.log'))?fs.readFileSync(path.join(dir,'postgres.log'),'utf8').slice(-10000):null,serviceLog:fs.existsSync(path.join(dir,'service.log'))?fs.readFileSync(path.join(dir,'service.log'),'utf8').slice(-20000):null});save();console.error(e);}
 finally{
  for(const db of openDatabases){try{await bounded(db.close(),'close receiver',10000);}catch(e){console.error(e.message);}}
  for(const p of proxies){try{await p.close();}catch{}}
  if(service&&service.exitCode===null){service.kill('SIGTERM');await Promise.race([new Promise(r=>service.once('exit',r)),sleep(10000)]);if(service.exitCode===null)service.kill('SIGKILL');}
  if(source)await source.end().catch(()=>{});if(admin)await admin.end().catch(()=>{});
  if(pgStarted)shell('pg_ctl',['-D',pgDir,'-m','fast','-w','stop']);
 }
}
save();fs.writeFileSync(path.join(here,'results/latest.txt'),runId+'\n');console.log('RESULTS '+resultDir);if(failures.length)process.exitCode=1;
