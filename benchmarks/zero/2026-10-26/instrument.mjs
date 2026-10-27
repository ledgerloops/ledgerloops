// Browser-platform instrumentation only. Original transactions/options/values pass through unchanged.
export function instrument() {
  window.wire = { received: 0, sent: 0, frames: 0 };
  const WS = window.WebSocket;
  window.WebSocket = class extends WS {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", (e) => {
        window.wire.received +=
          typeof e.data === "string"
            ? new TextEncoder().encode(e.data).length
            : (e.data.byteLength ?? e.data.size);
        window.wire.frames++;
      });
    }
    send(data) {
      window.wire.sent +=
        typeof data === "string"
          ? new TextEncoder().encode(data).length
          : (data.byteLength ?? data.size);
      return super.send(data);
    }
  };
  const txInfo = new WeakMap();
  const txn = IDBDatabase.prototype.transaction;
  IDBDatabase.prototype.transaction = function (...args) {
    const tx = txn.apply(this, args);
    if (args[1] === "readwrite") {
      const info = { db: this.name, markers: new Set(), putCount: 0, durability: tx.durability };
      txInfo.set(tx, info);
      tx.addEventListener("complete", () => {
        const st = window.stage;
        if (!st || info.db !== window.idbName) return;
        for (const s of info.markers) st.seen.add(s);
        if (info.markers.size)
          st.transactions.push({
            at_ms: performance.now() - st.t,
            puts: info.putCount,
            matched: info.markers.size,
            durability: info.durability,
          });
        if (st.ack === null && st.markers.every((s) => st.seen.has(s))) st.ack = performance.now();
      });
    }
    return tx;
  };
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...args) {
    const info = txInfo.get(this.transaction),
      st = window.stage;
    if (info && st && info.db === window.idbName) {
      info.putCount++;
      const s = JSON.stringify(value);
      for (const marker of st.markers) if (s.includes(marker)) info.markers.add(marker);
    }
    return put.call(this, value, ...args);
  };
}
