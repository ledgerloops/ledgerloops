// Optional synthetic reproduction of the collection-document reset timeout.
// Run under locked.py; not part of the primary initial-transfer samples.
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startLocalJazzServer,deploy } from 'jazz-tools/dev';
import { createJazzSession } from 'jazz-tools/backend';
import { makeModel,encodeModel,decodeModel,mutationFor } from './model.mjs';
import { fileAccountStore,sha,observer,readTables,bounded } from './util.mjs';
import { wireProxy } from './wire.mjs';

const lock=JSON.parse(await fs.readFile(path.join(process.env.HOME, 'Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock/owner.json'),'utf8'));
if(lock.engine!=='jazz'||lock.pid!==process.ppid)throw Error('Run through locked.py');
const fixture=JSON.parse(await fs.readFile(new URL('./fixture/fixture.json',import.meta.url),'utf8'));
const root=await fs.mkdtemp('/private/tmp/sync-benchmark-jazz-reset-');
const model=makeModel('collections'),encoded=encodeModel('collections',fixture);
const server=await startLocalJazzServer({host:'127.0.0.1',appId:randomUUID(),dataDir:path.join(root,'server'),schema:model.app,permissions:model.permissions,allowLocalFirstAuth:true});
await deploy({...server,schema:model.app,permissions:model.permissions,serverUrl:server.url});
const proxy=await wireProxy(server.port);
async function open(name,url,offline=false) {
  const dir=path.join(root,name);await fs.mkdir(dir,{recursive:true});
  const session=await createJazzSession({...model,appId:server.appId,serverUrl:url,driver:{type:'persistent',dataPath:path.join(dir,'data')},store:fileAccountStore(path.join(dir,'account.json')),initial:'local-first'});
  const db=session.getSnapshot().client.db;
  if(offline)await db.disconnect();else await db.all(model.app.ready,{tier:'remote'});
  return {session,db};
}
let writer,reader,obs;
try {
  writer=await open('sender',server.url);const ids={collections:[]};
  for(const row of encoded.collections){const w=writer.db.insert(model.app.collections,row);ids.collections.push(w.value.id);await w.wait({tier:'global'});}
  reader=await open('receiver',proxy.url);await reader.session.close();reader=await open('receiver',proxy.url);
  obs=observer(reader.db,model.app,model.tables,'collections',decodeModel);obs.start();await obs.wait(sha(fixture));obs.stop();await reader.session.close();
  proxy.offline();reader=await open('receiver',proxy.url,true);
  if(sha(decodeModel('collections',await readTables(reader.db,model.app,model.tables)))!==sha(fixture))throw Error('Reopen mismatch');
  proxy.offline(false);await reader.db.reconnect();await reader.db.all(model.app.ready,{tier:'remote'});
  obs=observer(reader.db,model.app,model.tables,'collections',decodeModel);obs.start();await obs.wait(sha(fixture));
  const expected=structuredClone(fixture);
  for(const [collection,field,value]of [
    ['issues','title',fixture.issues[0].title+' [benchmark-title]'],
    ['notes','body',fixture.notes[0].body[0].toUpperCase()+fixture.notes[0].body.slice(1)],
    ['issues','title',fixture.issues[0].title],['notes','body',fixture.notes[0].body],
  ]) {
    expected[collection][0][field]=value;
    const m=mutationFor('collections',encoded,ids,collection,0,field,value);proxy.reset();
    await bounded(writer.db.update(model.app[m.table],m.id,m.patch).wait({tier:'global'}),'reset global acceptance');
    console.log('GLOBAL_ACCEPTED',collection,field,sha(expected));
    await obs.wait(sha(expected));console.log('RECEIVER_CONVERGED',proxy.counts());
  }
  console.log('RESET_REPRO_SUCCEEDED',root);
} finally {
  obs?.stop();await reader?.session.close();await writer?.session.close();await proxy.close();await server.stop();
}
