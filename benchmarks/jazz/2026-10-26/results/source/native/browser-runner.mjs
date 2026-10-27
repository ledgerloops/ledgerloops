import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { wireProxy } from './wire.mjs';
import { canonical } from './model.mjs';
import { now,sleep,disk,netDisk,bounded } from './util.mjs';

async function browserDisk(profile) {
  // Only origin persistence. Entire browser profiles, executable/cache/code are excluded.
  const entries=await Promise.all(['Default/IndexedDB','Default/Local Storage','Default/WebStorage'].map(async relative=>({ relative,...await disk(path.join(profile,relative)) })));
  return {apparent:entries.reduce((n,d)=>n+d.apparent,0),allocated:entries.reduce((n,d)=>n+d.allocated,0),
    files:entries.flatMap(d=>d.files.map(f=>({...f,path:d.relative+'/'+f.path})))};
}

export async function browserTransfers(args) {
  const {model,mode,server,writer,encoded,ids,variantRoot,root,here,resultsDir,fixture,expectedHash,warmups,repetitions,incrementals}=args;
  const binary=process.env.JAZZ_BROWSER_ROOT??'/private/tmp/sync-benchmark-jazz-20261026-runtime/browsers';
  process.env.PLAYWRIGHT_BROWSERS_PATH=binary;
  // Playwright's registry reads the environment at import time. Resolve the pinned installed binary explicitly.
  const candidates=await fs.readdir(binary);
  const headless=candidates.find(n=>n.startsWith('chromium_headless_shell-'));
  const full=candidates.find(n=>n.startsWith('chromium-'));
  const executablePath=process.env.JAZZ_BROWSER_EXECUTABLE??(headless?path.join(binary,headless,'chrome-mac/headless_shell'):path.join(binary,full,'chrome-mac/Chromium.app/Contents/MacOS/Chromium'));
  const vite=await createServer({root:here,cacheDir:path.join(variantRoot,'vite-cache'),server:{host:'127.0.0.1',port:0},logLevel:'warn',optimizeDeps:{include:['jazz-tools']}});
  await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  const expected=canonical(fixture);const rows=[];
  async function open(profile,proxy,offline=false) {
    const context=await chromium.launchPersistentContext(profile,{headless:true,executablePath});
    const page=context.pages()[0]??await context.newPage();
    page.setDefaultTimeout(120000);
    page.on('pageerror',e=>console.error('BROWSER_PAGE_ERROR',e.message));
    context.on('weberror',e=>console.error('BROWSER_WEB_ERROR',e.error().message));
    await context.route('**/*',route=>{ const host=new URL(route.request().url()).hostname; return ['127.0.0.1','localhost'].includes(host)?route.continue():route.abort(); });
    try {
      await page.goto(origin);await page.waitForFunction(()=>window.benchReady);
      await bounded(page.evaluate(config=>window.bench.open(config),{mode,appId:server.appId,serverUrl:proxy.url,offline}),'browser persistent initialization');
      return {context,page};
    } catch(error) {await context.close();throw error;}
  }
  try {
    for(let run=0;run<warmups+repetitions;run++) {
      const profile=path.join(variantRoot,'receivers',String(run));const proxy=await wireProxy(server.port);let receiver;
      try {
        receiver=await open(profile,proxy);const browserVersion=receiver.context.browser()?.version();
        await receiver.page.evaluate(()=>window.bench.close());await receiver.context.close();receiver=null;
        const baseline=await browserDisk(profile);
        const connectStart=now();receiver=await open(profile,proxy);const connectMs=now()-connectStart;
        await sleep(20);proxy.reset();const wallStart=now();
        const observed=await bounded(receiver.page.evaluate(expected=>window.bench.start(expected),expected),'browser full fixture');
        const hostObserved=now()-wallStart;const wire=proxy.counts();
        await receiver.page.evaluate(()=>window.bench.close());await receiver.context.close();receiver=null;
        const closeMs=now()-wallStart;
        const total=await browserDisk(profile);
        proxy.offline();const reopenStart=now();receiver=await open(profile,proxy,true);
        const verification=await receiver.page.evaluate(expected=>window.bench.verify(expected),expected);
        const record={runtime:'browser',browser:browserVersion,storage:'IndexedDB page store in SharedWorker; synthetic local account in localStorage',
          model:mode,run,warmup:run<warmups,connection_auth_open_ms:connectMs,
          observable_ms:observed.observable_ms,host_observable_ms:hostObserved,durable_ms:null,
          graceful_close_upper_bound_ms:closeMs,durability_boundary:'Awaited Jazz session close and Chromium context close; IndexedDB transaction commit is weaker than an explicit power-loss fsync receipt. Do not rank as native durable timing.',
          wire,receiver_storage:{baseline,total,net:netDisk(total,baseline)},
          reopen:{offline_proxy_blocked:true,...verification,verified_hash:expectedHash,elapsed_ms:now()-reopenStart}};
        if(run===warmups+repetitions-1) {
          try {
          proxy.offline(false);await receiver.page.evaluate(()=>window.bench.reconnect());
          await receiver.page.evaluate(expected=>window.bench.start(expected),expected);
          // Bridge receiver browser callbacks to the host clock. Report that this includes Playwright IPC overhead.
          const observe={wait(hash) {
            const data=hash===expectedHash?fixture:hashToFixture.get(hash);
            if(!data)throw new Error('Expected incremental fixture not registered');
            return bounded(receiver.page.evaluate(expected=>window.bench.wait(expected),canonical(data)),'browser incremental convergence').then(()=>({observed_at:now()}));
          }};
          // Incremental expectations in exactly the same order as the shared native runner.
          const {sha}=await import('./util.mjs');const hashToFixture=new Map([[expectedHash,fixture]]);
          const updated=structuredClone(fixture);
          for(let rep=0;rep<repetitions;rep++) {
            updated.issues[0].title=fixture.issues[0].title+` [benchmark-title-${rep}]`;
            hashToFixture.set(sha(updated),structuredClone(updated));
            updated.notes[0].body=fixture.notes[0].body+` [benchmark-body-${rep}]`;
            hashToFixture.set(sha(updated),structuredClone(updated));
          }
          record.incrementals=await incrementals({writer,model,encoded,ids,mode,observe,proxy});
          record.incremental_clock_note='Observable convergence measured at host callback, includes Playwright evaluation IPC.';
          } catch(error) {
            record.incrementals=error.completed??[];record.incremental_error={message:error.message,stack:error.stack,operation:error.operation};
            console.error('BROWSER_INCREMENTAL_BLOCKED',mode,error);
          }
        }
        await receiver.page.evaluate(()=>window.bench.close());await receiver.context.close();receiver=null;
        if(record.incrementals?.length) {
          const expectedChanged=structuredClone(fixture);const last=record.incrementals.at(-1).repetition;
          expectedChanged.issues[0].title=fixture.issues[0].title+` [benchmark-title-${last}]`;
          const bodyRep=record.incrementals.at(-1).field==='body'?last:last-1;
          expectedChanged.notes[0].body=fixture.notes[0].body+(bodyRep>=0?` [benchmark-body-${bodyRep}]`:'');
          proxy.offline();receiver=await open(profile,proxy,true);
          await receiver.page.evaluate(expected=>window.bench.verify(expected),canonical(expectedChanged));
          record.incrementals_final_reopen={verified_hash:record.incrementals.at(-1).verified_hash,offline_proxy_blocked:true};
          await receiver.page.evaluate(()=>window.bench.close());await receiver.context.close();receiver=null;
        }
        rows.push(record);await fs.writeFile(path.join(resultsDir,`browser-${mode}.json`),JSON.stringify(rows,null,2)+'\n');
        console.log(JSON.stringify({runtime:'browser',mode,run,warmup:record.warmup,observable_ms:record.observable_ms,graceful_close_upper_bound_ms:closeMs,wire:wire.received_ws_payload_bytes}));
      } finally {if(receiver)await receiver.context.close().catch(()=>{});await proxy.close();}
    }
  } finally {await vite.close();}
  return rows;
}
