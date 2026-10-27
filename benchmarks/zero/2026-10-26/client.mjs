import { Zero } from "@rocicorp/zero";
import { model, reconstruct, canonical } from "./model.mjs";
let z,
  m,
  views = [],
  variant;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
window.bench = {
  async open(config) {
    variant = config.variant;
    m = model(variant);
    const t = performance.now();
    z = new Zero({
      schema: m.schema,
      queries: m.queries,
      mutators: m.mutators,
      userID: config.userID,
      auth: config.auth,
      cacheURL: config.cacheURL,
      logLevel: "error",
      onStorageFailure: (e) => {
        throw Error("Storage failed " + e.kind);
      },
    });
    while (z.connection.state.current.name !== "connected") {
      if (["error", "needs-auth"].includes(z.connection.state.current.name))
        throw Error(JSON.stringify(z.connection.state.current));
      if (performance.now() - t > 60000)
        throw Error("Connection timeout " + JSON.stringify(z.connection.state.current));
      await sleep(5);
    }
    if (z.kvStore.kind !== "idb") throw Error("Native IDB required: " + z.kvStore.kind);
    window.idbName = z.idbName;
    return { connection_ms: performance.now() - t, idbName: z.idbName, storage: z.kvStore.kind };
  },
  async openOffline(config) {
    variant = config.variant;
    m = model(variant);
    z = new Zero({
      schema: m.schema,
      queries: m.queries,
      mutators: m.mutators,
      userID: config.userID,
      cacheURL: undefined,
      logLevel: "error",
    });
    await z.run(m.zql[Object.keys(m.schema.tables)[0]]);
    window.idbName = z.idbName;
    if (z.kvStore.kind !== "idb") throw Error("Offline native IDB unavailable");
  },
  async sync() {
    const t = performance.now();
    window.stage = {
      t,
      markers: Array.from({ length: 21 }, (_, i) => `issue-${String(i).padStart(3, "0")}`).concat(
        Array.from({ length: 111 }, (_, i) => `note-${String(i).padStart(3, "0")}`),
      ),
      seen: new Set(),
      ack: null,
      transactions: [],
    };
    window.wire = { received: 0, sent: 0, frames: 0 };
    views = Object.keys(m.defs).map((k) => [k, z.materialize(m.queries[k]())]);
    await Promise.all(
      views.map(
        ([k, v]) =>
          new Promise((resolve, reject) => {
            setTimeout(() => reject(Error("Full query hydration timeout")), 30000);
            v.addListener((data, type) => {
              if (type === "complete" || type?.type === "complete") resolve();
              else if (type === "error" || type?.type === "error")
                reject(Error(JSON.stringify(type)));
            });
          }),
      ),
    );
    const readable = performance.now() - t;
    const data = reconstruct(variant, Object.fromEntries(views.map(([k, v]) => [k, v.data])));
    if (data.issues.length !== 21 || data.notes.length !== 111) throw Error("Full dataset missing");
    await this.waitPersistence();
    return {
      readable_ms: readable,
      persistence_transaction_ms: window.stage.ack - t,
      durable_ms: null,
      wire: { ...window.wire },
      persistence_transactions: window.stage.transactions,
    };
  },
  async waitPersistence() {
    const t = performance.now();
    while (window.stage.ack === null) {
      if (performance.now() - t > 30000) throw Error("No matching payload IDB commit observed");
      await sleep(2);
    }
  },
  snapshot() {
    return reconstruct(variant, Object.fromEntries(views.map(([k, v]) => [k, v.data])));
  },
  armUpdate(marker) {
    window.wire = { received: 0, sent: 0, frames: 0 };
    window.stage = {
      t: performance.now(),
      markers: [marker],
      seen: new Set(),
      ack: null,
      transactions: [],
    };
    return window.stage.t;
  },
  async waitUpdate(collection, field, value) {
    const t = window.stage.t;
    let readable;
    while (true) {
      const data = this.snapshot();
      if (data[collection][0][field] === value) {
        readable = performance.now() - t;
        break;
      }
      if (performance.now() - t > 30000) throw Error("Update timeout");
      await sleep(1);
    }
    await this.waitPersistence();
    return {
      readable_ms: readable,
      persistence_transaction_ms: window.stage.ack - t,
      durable_ms: null,
      wire: { ...window.wire },
      persistence_transactions: window.stage.transactions,
    };
  },
  async offlineRead() {
    views = Object.keys(m.defs).map((k) => [k, z.materialize(m.zql[k].orderBy("id", "asc"))]);
    await sleep(50);
    return this.snapshot();
  },
  async close() {
    await z.close();
    views = [];
  },
  canonical,
};
