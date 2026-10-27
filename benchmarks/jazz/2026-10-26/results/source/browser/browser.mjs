import { createJazzSession } from 'jazz-tools';
import { makeModel,decodeModel,canonical } from './model.mjs';

let session,db,model,results={},unsub=[],waiter,latest,fatal;
const encode = value => canonical(value);
function check() {
  try { latest=decodeModel(window.mode,results); } catch { return; }
  if(waiter && encode(latest)===waiter.expected) { const w=waiter;waiter=null;w.resolve({observed_at:performance.now()}); }
}
window.bench = {
  async open(config) {
    window.mode=config.mode; model=makeModel(config.mode);
    session=await createJazzSession({appId:config.appId,serverUrl:config.serverUrl,
      driver:{type:'persistent',dbName:'synthetic-benchmark'},initial:'local-first',
      runtimeSources:{wasmUrl:new URL('/node_modules/jazz-wasm/pkg/jazz_wasm_bg.wasm',location.href).href,
        brokerWorkerUrl:new URL('/node_modules/jazz-tools/dist/worker/jazz-broker-worker.js',location.href).href,wasmVersion:'2.0.0-alpha.59'}});
    const snap=session.getSnapshot();if(!snap.client) throw snap.error??new Error(snap.status);
    db=snap.client.db;
    if(config.offline) await db.disconnect();
    else await db.all(model.app.ready,{tier:'remote'});
    return {status:snap.status,origin:location.origin};
  },
  async start(expected) {
    results={};latest=undefined;fatal=undefined;
    const t0=performance.now();
    const pending=this.wait(expected);
    for(const name of model.tables) unsub.push(db.subscribe(model.app[name],{
      onUpdate(rows){results[name]=rows;check();},onError(e){fatal=e;waiter?.reject(e);},
    },{tier:'remote'}));
    const got=await pending;
    return {observable_ms:got.observed_at-t0};
  },
  wait(expected) {
    if(fatal)return Promise.reject(fatal);
    if(latest && encode(latest)===expected)return Promise.resolve({observed_at:performance.now()});
    return new Promise((resolve,reject)=>{waiter={expected,resolve,reject};});
  },
  async verify(expected) {
    const data={};for(const name of model.tables)data[name]=await db.all(model.app[name],{tier:'local-first'});
    const actual=decodeModel(window.mode,data);
    if(encode(actual)!==expected)throw new Error('Offline reopened fixture differs');
    return {equal:true,bytes:new TextEncoder().encode(encode(actual)).length};
  },
  async reconnect() { await db.reconnect();await db.all(model.app.ready,{tier:'remote'}); },
  async close() { for(const stop of unsub)stop();unsub=[];await session.close(); },
};
window.benchReady=true;
