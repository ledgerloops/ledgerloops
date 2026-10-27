import {Replicache, version} from 'replicache';
import {decodeModel} from './model.js';

let rep, model, watcher, unsubscribe, stage;
const auth = 'Bearer synthetic-replicache-benchmark-v1';
const timeout = (promise, ms = 20000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Error('Receiver stage timeout')), ms))]);
window.bench = {
  version,
  async open(m, name) {
    const begin = performance.now();
    model = m;
    // Empty URLs prevent constructor's automatic pull from preceding the timer.
    rep = new Replicache({name, schemaVersion:'fixture-v1-' + model, auth,
      pullInterval:null, kvStore:'idb', indexes:{}});
    await rep.query(tx => tx.isEmpty());
    await rep.clientGroupID;
    if (!(await indexedDB.databases()).some(db => db.name === rep.idbName)) throw Error('Persistent database missing');
    watcher = new BroadcastChannel('replicache-on-persist:' + name);
    watcher.onmessage = event => {
      if (stage && event.data.clientID === rep.clientID) {
        stage.persistEvents.push({at:performance.now(), data:event.data});
        if (stage.observableAt !== null) stage.persistResolve(performance.now());
      }
    };
    const initial = new Promise((resolve, reject) => {
      unsubscribe = rep.subscribe(tx => tx.scan().entries().toArray(), {
        onData(entries) {
          if (!stage) {resolve();return;}
          const data = decodeModel(entries, model);
          if (data.issues.length !== 21 || data.notes.length !== 111) return;
          if (stage.target >= 2 && !data.issues[0].title.endsWith(' [synthetic title update]')) return;
          if (stage.target >= 3 && !data.notes[0].body.endsWith(' [synthetic note body update]')) return;
          if (stage.observableAt === null) {
            stage.observableAt = performance.now();
            stage.observableResolve(stage.observableAt);
          }
        }, onError:reject
      });
    });
    await timeout(initial);
    const connectionStart = performance.now();
    const response = await fetch('/ready', {headers:{Authorization:auth}, cache:'no-store'});
    if (response.status !== 200) throw Error('Synthetic authentication failed');
    await response.text();
    return {open_ms:connectionStart-begin, connection_auth_ms:performance.now()-connectionStart,
      idb_name:rep.idbName, databases:await indexedDB.databases(), persistence_granted:await navigator.storage.persisted()};
  },
  async transfer(target) {
    let observableResolve, persistResolve;
    const observable = new Promise(resolve => observableResolve=resolve);
    const persisted = new Promise(resolve => persistResolve=resolve);
    stage = {target, observableAt:null, observableResolve, persistResolve, persistEvents:[]};
    rep.pullURL = '/pull';
    const t0 = performance.now();
    await rep.pull({now:true});
    const pullAt = performance.now();
    const [observableAt,persistAt] = await timeout(Promise.all([observable,persisted]));
    const events = stage.persistEvents.map(v => ({elapsed_ms:v.at-t0,...v.data}));
    stage = null;
    rep.pullURL = '';
    return {observable_ms:observableAt-t0, pull_ms:pullAt-t0,
      persistence_notification_ms:persistAt-t0, durable_ms:null,
      persistence_boundary:'source-backed internal BroadcastChannel after default relaxed IndexedDB commit; not a public durability API',
      persist_events:events};
  },
  async read() {return rep.query(async tx => decodeModel(await tx.scan().entries().toArray(), model));},
  async accounting() {return navigator.storage.estimate();},
  async close() {stage=null;unsubscribe?.();watcher?.close();await rep.close();}
};
