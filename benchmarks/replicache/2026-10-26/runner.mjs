import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {models, encodeModel, decodeModel, canonical, changed, patchBetween} from './model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = process.env.BENCHMARK_WORK_DIR
  ? path.resolve(process.env.BENCHMARK_WORK_DIR) : path.join(here, '.work');
const runName = process.env.RUN_NAME || 'measured';
const dataRoot = process.env.BENCHMARK_DATA_ROOT
  ? path.resolve(process.env.BENCHMARK_DATA_ROOT,runName) : path.join(work,runName);
await fs.mkdir(dataRoot,{recursive:true});
const fixtureBlob = await fs.readFile(path.join(here,'fixture/fixture.json'));
const fixture = JSON.parse(fixtureBlob);
const sha = x => crypto.createHash('sha256').update(x).digest('hex');
assert.equal(fixtureBlob.length,415448);
assert.equal(sha(fixtureBlob),'9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a');
const inputModels = process.env.MODELS?.split(',') || models;
const warmups = +(process.env.WARMUPS ?? 3);
const repetitions = +(process.env.REPETITIONS ?? 10);
const chromePath = process.env.CHROMIUM_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const auth = 'Bearer synthetic-replicache-benchmark-v1';
const bundle = await fs.readFile(path.join(work,'receiver.js'));
let active;
const logs = [];
const browserContexts = new Set();
const sockets = new Set();
const server = http.createServer(async (req,res) => {
  res.setHeader('Cache-Control','no-store');
  if (req.url === '/') {res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta charset="utf-8"><script type="module" src="/receiver.js"></script>');return;}
  if (req.url === '/receiver.js') {res.setHeader('Content-Type','text/javascript');res.end(bundle);return;}
  if (req.url === '/favicon.ico') {res.writeHead(204);res.end();return;}
  if (req.headers.authorization !== auth) {res.writeHead(401);res.end();return;}
  if (req.url === '/ready') {res.end('synthetic-ready');return;}
  if (req.url !== '/pull' || req.method !== 'POST') {res.writeHead(404);res.end();return;}
  try {
    let body = '';for await (const part of req) body += part;
    const request = JSON.parse(body);
    assert.equal(request.pullVersion,1);assert.equal(request.schemaVersion,'fixture-v1-'+active.model);
    assert.equal(typeof request.clientGroupID,'string');assert.equal(typeof request.profileID,'string');
    const old = request.cookie;
    assert(old === null || (Number.isInteger(old) && old >= 1 && old <= active.version));
    const response = active.responses.get(`${old}:${active.version}`);
    assert(response);
    const bytes=Buffer.byteLength(response);
    res.setHeader('Content-Type','application/json');res.setHeader('Content-Length',bytes);
    res.end(response);
    logs.push({utc:new Date().toISOString(),run:active.run,model:active.model,
      from_cookie:old,to_cookie:active.version,request_bytes:Buffer.byteLength(body),response_bytes:bytes,
      patch_keys:JSON.parse(response).patch.filter(p=>p.op==='put').map(p=>p.key),compression:'identity'});
  } catch(error) {res.writeHead(400);res.end(String(error));logs.push({error:String(error)});}
});
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const environment = {
  utc:new Date().toISOString(),node:process.version,os:os.version(),kernel:os.release(),architecture:os.arch(),
  macos:execFileSync('sw_vers',[],{encoding:'utf8'}),
  cpu:os.cpus()[0].model,logical_cpus:os.cpus().length,ram_bytes:os.totalmem(),loadavg:os.loadavg(),
  platform:os.platform(),container:'none; native macOS',cpu_quota:'none',ram_cgroup_limit:'not applicable',
  storage_path:dataRoot,filesystem:execFileSync('df',['-k',dataRoot],{encoding:'utf8'}),
  filesystem_mount:execFileSync('mount',[],{encoding:'utf8'}).split('\n').filter(s=>s.includes(' on /System/Volumes/Data ')),
  browser_executable:chromePath,browser_version:execFileSync(chromePath,['--version'],{encoding:'utf8'}).trim(),
  engine_version:'replicache@15.3.0',engine_source_commit:'8684fb19c032e25f7f166f40e8acdfb179e6ca87',
  playwright:'1.64.1',topology:'Node HTTP/1.1 loopback pull server; headless Chromium persistent IndexedDB receiver',
  indexes:'default primary key B-tree only; no application secondary indexes',durability:'unmodified engine default: relaxed IndexedDB',
  port:server.address().port,warmups,repetitions,shared_lock:process.env.BENCHMARK_LOCK_TOKEN || 'wrapper owner.json',
};
await fs.writeFile(path.join(here,runName+'-environment.json'),JSON.stringify(environment,null,2));
async function filesAt(dir) {
  let out=[];
  for (const e of await fs.readdir(dir,{withFileTypes:true}).catch(()=>[])) {
    const p=path.join(dir,e.name);
    if(e.isDirectory()) out.push(...await filesAt(p));
    else if(e.isFile()) {const s=await fs.stat(p);out.push({path:p,apparent_bytes:s.size,allocated_bytes:s.blocks*512});}
  }
  return out;
}
async function disk(dir) {
  const files=await filesAt(dir);
  return {apparent_bytes:files.reduce((s,v)=>s+v.apparent_bytes,0),allocated_bytes:files.reduce((s,v)=>s+v.allocated_bytes,0),files};
}
const net = (a,b) => ({apparent_bytes:b.apparent_bytes-a.apparent_bytes,allocated_bytes:b.allocated_bytes-a.allocated_bytes});
async function openBrowser(profile,model,name,offline=false) {
  const start=performance.now();
  const context=await chromium.launchPersistentContext(profile,{executablePath:chromePath,headless:true});
  browserContexts.add(context);
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const page=context.pages()[0]||await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.goto(origin);
  await page.waitForFunction(()=>!!window.bench);
  if(offline) await context.route('**/pull',route=>route.abort());
  const prep=await page.evaluate(([m,n])=>window.bench.open(m,n),[model,name]);
  prep.browser_and_open_ms=performance.now()-start;
  return {context,page,prep,errors};
}
async function closeBrowser(browser) {
  const t=performance.now();await browser.page.evaluate(()=>window.bench.close());await browser.context.close();
  browserContexts.delete(browser.context);
  assert.deepEqual(browser.errors,[]);
  return performance.now()-t;
}
async function verify(browser, expected) {
  const received=await browser.page.evaluate(()=>window.bench.read());
  assert.equal(canonical(received),canonical(expected));
  return {sha256:sha(canonical(received)),bytes:Buffer.byteLength(canonical(received)),issues:received.issues.length,notes:received.notes.length,full_content_equal:true};
}
const results=[];
try {
  for(const model of inputModels) {
    assert(models.includes(model));
    const prepStart=performance.now();
    const serviceDir=path.join(dataRoot,'service',model);await fs.mkdir(serviceDir,{recursive:true});
    const views = new Map([1,2,3].map(v=>[v,encodeModel(changed(fixture,v),model)]));
    for(const v of [1,2,3]) assert.equal(canonical(decodeModel([...views.get(v)],model)),canonical(changed(fixture,v)));
    const responses=new Map();
    for(const to of [1,2,3]) for(const from of [null,1,2,3].filter(v=>v===null||v<=to)) {
      const body=JSON.stringify({cookie:to,lastMutationIDChanges:{},patch:patchBetween(from===null?null:views.get(from),views.get(to))});
      responses.set(`${from}:${to}`,body);
    }
    // The local service persists its authoritative views and prepared response cache.
    // These are service-owned data, excluded from receiver storage.
    await fs.writeFile(path.join(serviceDir,'views.json'),JSON.stringify([...views].map(([v,map])=>[v,[...map]])));
    await fs.writeFile(path.join(serviceDir,'responses.json'),JSON.stringify([...responses]));
    const serviceDisk=await disk(serviceDir),senderPreparationMs=performance.now()-prepStart;
    for(let index=-warmups;index<repetitions;index++) {
      const warmup=index<0;
      const run=`${model}-${warmup?'warmup'+(index+warmups):index}`;
      const profile=path.join(dataRoot,'profiles',run);
      await fs.mkdir(profile,{recursive:true});
      // Never reuse an old receiver when re-running commands.
      assert.equal((await fs.readdir(profile)).length,0,'Run name already used; choose a fresh RUN_NAME');
      active={model,version:1,responses,run};
      const name='synthetic-'+run;
      let browser=await openBrowser(profile,model,name);
      assert.equal((await browser.page.evaluate(()=>window.bench.read())).issues.length,0);
      const initialPrep=browser.prep;
      await closeBrowser(browser);
      const idbDir=path.join(profile,'Default','IndexedDB');
      const baseline=await disk(idbDir);assert(baseline.apparent_bytes>0);
      browser=await openBrowser(profile,model,name);
      const row={run,model,warmup,index,utc:new Date().toISOString(),key_count:views.get(1).size,
        sender_preparation_ms:senderPreparationMs,service_disk:serviceDisk,baseline,
        initialized_empty_preparation:initialPrep,receiver_preparation:browser.prep,loadavg:os.loadavg(),stages:[]};
      for(const v of [1,2,3]) {
        active.version=v;const logStart=logs.length;
        const cdp=await browser.context.newCDPSession(browser.page);await cdp.send('Network.enable');
        let cdpResponseBodyBytes=0,cdpEncodedBytes=0,requestID;
        cdp.on('Network.responseReceived',event=>{if(event.response.url===origin+'/pull')requestID=event.requestId;});
        cdp.on('Network.dataReceived',event=>{if(event.requestId===requestID)cdpResponseBodyBytes+=event.dataLength;});
        cdp.on('Network.loadingFinished',event=>{if(event.requestId===requestID)cdpEncodedBytes+=event.encodedDataLength;});
        const timings=await browser.page.evaluate(v=>window.bench.transfer(v),v);
        const accounting=await browser.page.evaluate(()=>window.bench.accounting());
        const correctness=await verify(browser,changed(fixture,v));
        const wire=logs.slice(logStart);assert.equal(wire.length,1);assert.equal(wire[0].from_cookie,v===1?null:v-1);
        await cdp.detach();
        const closeMs=await closeBrowser(browser);
        const total=await disk(idbDir);
        // Reopen the same persistent profile/database with networking disabled for
        // replication, verify the entire reconstructed fixture outside timing.
        browser=await openBrowser(profile,model,name,true);
        const reopened=await verify(browser,changed(fixture,v));
        row.stages.push({kind:['','initial','issue_title','note_body'][v],version:v,...timings,wire,
          received_protocol_bytes:wire[0].response_bytes,received_compressed_body_bytes:wire[0].response_bytes,
          cdp_response_body_bytes:cdpResponseBodyBytes,cdp_encoded_bytes_including_http_headers:cdpEncodedBytes,
          changed_source_field_added_bytes:v===1?null:Buffer.byteLength(v===2?' [synthetic title update]':' [synthetic note body update]'),
          accounting,correctness,reopened,close_ms:closeMs,storage_total:total,storage_net:net(baseline,total)});
        if(v<3) {
          // The persistent receiver remains open and subscribed for the next
          // server-side one-field update. Restore only the normal network route.
          await browser.context.unroute('**/pull');
        }
      }
      await closeBrowser(browser);
      results.push(row);
      await fs.writeFile(path.join(here,runName+'-results.json'),JSON.stringify({environment,results,server_log:logs},null,2));
      console.log(JSON.stringify({run,warmup,initial:row.stages[0].observable_ms,persist:row.stages[0].persistence_notification_ms}));
    }
  }
} finally {
  for(const context of browserContexts)await context.close().catch(()=>{});
  for(const socket of sockets)socket.destroy();
  await new Promise(resolve=>server.close(resolve));
}
console.log('Completed '+results.length+' fresh persistent receiver runs.');
