import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import net from "node:net";
import crypto from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import pg from "pg";
import Database from "@rocicorp/zero-sqlite3";
import { SignJWT, jwtVerify } from "jose";
const authSecret = new TextEncoder().encode("synthetic-zero-issue-44-local-benchmark-secret-only");
const tokenFor = (userID) =>
  new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userID)
    .setIssuer("synthetic-benchmark")
    .setAudience("zero-local")
    .setExpirationTime("2h")
    .sign(authSecret);
async function requestUserID(request) {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) throw Error("Synthetic authentication required");
  return (
    await jwtVerify(header.slice(7), authSecret, {
      issuer: "synthetic-benchmark",
      audience: "zero-local",
    })
  ).payload.sub;
}
import { handleQueryRequest, handleMutateRequest } from "@rocicorp/zero/server";
import { zeroNodePg } from "@rocicorp/zero/server/adapters/pg";
import { mustGetQuery, mustGetMutator } from "@rocicorp/zero";
import { model, rows, reconstruct, canonical } from "./model.mjs";
import { instrument } from "./instrument.mjs";
const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);
const work = path.resolve(process.env.BENCHMARK_DATA_ROOT || path.resolve(root, "../../work"));
const pgSocket = path.join(work, "pg-socket");
await fs.mkdir(pgSocket, { recursive: true });
const out = path.join(root, "results");
await fs.mkdir(out, { recursive: true });
const runID = process.env.RUN_ID || new Date().toISOString().replace(/[:.]/g, "-");
const runRoot = path.join(work, runID);
await fs.mkdir(runRoot, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fixture = JSON.parse(await fs.readFile("fixture/fixture.json", "utf8"));
const manifest = JSON.parse(await fs.readFile("fixture/manifest.json", "utf8"));
if (crypto.createHash("sha256").update(canonical(fixture)).digest("hex") !== manifest.sha256)
  throw Error("Fixture SHA mismatch");
const resultFile = path.join(out, runID + ".json");
const results = {
  measurement_schema: 2,
  issue: "https://github.com/ledgerloops/ledgerloops/issues/44",
  runID,
  started_utc: new Date().toISOString(),
  manifest,
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    kernel: os.release(),
    cpu_model: os.cpus()[0].model,
    logical_cpu_count: os.cpus().length,
    ram_bytes: os.totalmem(),
    cpu_quota: null,
    ram_cgroup_limit: null,
    storage_path: runRoot,
    container: false,
    postgres: execFileSync("postgres", ["--version"], { encoding: "utf8" }).trim(),
    os: execFileSync("sw_vers", [], { encoding: "utf8" }),
    filesystem: execFileSync("df", ["-h", runRoot], { encoding: "utf8" }),
    mount: execFileSync("mount", [], { encoding: "utf8" })
      .split("\n")
      .filter((s) => s.includes("/System/Volumes/Data"))
      .join("\n"),
  },
  variants: [],
  limitations: [
    "Native IndexedDB writes use relaxed durability: no strict durable completion timing is claimed.",
    "Persistence instrumentation times committed transactions containing all payload IDs (or update marker); full reconstruction and indexes are verified by native offline reopening outside timing.",
    "Six local workers; sustained work serialized by shared lock, Atomic priority honored, OS/background activity uncontrolled. Browser-platform instrumentation overhead is included.",
    "Wire counts exclude TLS/IP/TCP headers, retransmits, loopback framing and PG/cache/API internal traffic.",
  ],
  wire_definition: {
    application: "UTF-8 WebSocket message payloads after browser decompression",
    transport:
      "server-to-client TCP stream bytes across dedicated proxy, including WebSocket frame headers and compressed payloads; connection handshake is excluded by timer snapshots",
  },
  durability: {
    mode: "native IDB relaxed; unchanged",
    durable_ms: null,
    persistence_transaction_ms:
      "weaker IDB payload transaction complete acknowledgement; not fsync/power-loss durability",
  },
  method: {
    warmups: Number(process.env.WARMUPS || 3),
    measured: Number(process.env.MEASURED || 10),
    fresh_persistent_receiver: true,
    normal_replication:
      "PG logical WAL -> zero-cache SQLite -> named-query WebSocket -> Zero native IDB",
    timer_start:
      "after transport connected, immediately before materialize all unbounded named queries",
    indexes:
      "Postgres primary keys only; cache derives native indexes; Zero native client metadata/indexes",
    compaction: "none explicitly requested",
  },
};
results.environment.dependencies = JSON.parse(
  await fs.readFile("package.json", "utf8"),
).dependencies;
results.environment.package_lock_sha256 = crypto
  .createHash("sha256")
  .update(await fs.readFile("package-lock.json"))
  .digest("hex");
const save = () => fs.writeFile(resultFile, JSON.stringify(results, null, 2) + "\n");
await save();
async function disk(p) {
  let apparent = 0,
    allocated = 0,
    files = 0;
  async function walk(q) {
    for (const d of await fs.readdir(q, { withFileTypes: true }).catch(() => [])) {
      const f = path.join(q, d.name);
      if (d.isDirectory()) await walk(f);
      else if (d.isFile()) {
        const s = await fs.stat(f);
        apparent += s.size;
        allocated += s.blocks * 512;
        files++;
      }
    }
  }
  await walk(p);
  return { apparent_bytes: apparent, allocated_bytes: allocated, files };
}
async function receiverDisk(profile) {
  const entries = await fs.readdir(path.join(profile, "Default")).catch(() => []),
    parts = {};
  for (const name of entries)
    if (
      ["IndexedDB", "WebStorage", "Local Storage", "Session Storage"].includes(name) ||
      name.startsWith("QuotaManager")
    ) {
      const p = path.join(profile, "Default", name);
      const s = await fs.stat(p);
      parts[name] = s.isDirectory()
        ? await disk(p)
        : { apparent_bytes: s.size, allocated_bytes: s.blocks * 512, files: 1 };
    }
  return {
    apparent_bytes: Object.values(parts).reduce((a, s) => a + s.apparent_bytes, 0),
    allocated_bytes: Object.values(parts).reduce((a, s) => a + s.allocated_bytes, 0),
    parts,
  };
}
function netGrowth(base, total) {
  return {
    apparent_bytes: total.apparent_bytes - base.apparent_bytes,
    allocated_bytes: total.allocated_bytes - base.allocated_bytes,
  };
}
function start(cmd, args, env, log) {
  const f = spawn(cmd, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const sink = fs.open(log, "a");
  f.stdout.on("data", async (d) => (await sink).write(d));
  f.stderr.on("data", async (d) => (await sink).write(d));
  return f;
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}
async function free(port) {
  await new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => s.close(resolve));
  });
}
const ports = { pg: 19440, cache: 19442, api: 19445, proxy: 19446 };
for (const p of [...Object.values(ports), 19443, 19444]) await free(p);
results.environment.ports = ports;
results.environment.topology = {
  sync_workers: 1,
  internal_change_streamer: "127.0.0.1:19443",
  browser_persistence: "IndexedDB",
  sqlite_replica_journal: "native WAL2",
  sqlite_replica_synchronous: "native NORMAL",
};
const executablePath = process.env.CHROMIUM_EXECUTABLE || chromium.executablePath();
async function launch(profile) {
  return chromium.launchPersistentContext(profile, {
    executablePath,
    headless: true,
    args: ["--no-first-run", "--no-default-browser-check", "--disable-background-networking"],
    serviceWorkers: "block",
  });
}
function assertData(data, expected, label) {
  const c = canonical(data),
    e = canonical(expected);
  if (c !== e) throw Error("Full reconstruction mismatch: " + label);
  return {
    verified: true,
    sha256: crypto.createHash("sha256").update(c).digest("hex"),
    bytes: Buffer.byteLength(c),
    issues: data.issues.length,
    notes: data.notes.length,
  };
}
async function sample(pool) {
  const { rows } = await pool.query(
    "SELECT datname, pg_database_size(oid)::text AS bytes FROM pg_database WHERE NOT datistemplate",
  );
  return Object.fromEntries(rows.map((r) => [r.datname, Number(r.bytes)]));
}
for (const variant of (process.env.VARIANTS || "typed,record,collection").split(",")) {
  const vroot = path.join(runRoot, variant);
  await fs.mkdir(vroot, { recursive: true });
  const v = { variant, status: "preparing", runs: [], services: {}, sender_preparation_ms: null };
  results.variants.push(v);
  await save();
  let cache, api, proxy, pool, admin, ctx;
  let pgStarted = false;
  const pdir = path.join(vroot, "postgres");
  const log = path.join(vroot, "postgres.log");
  try {
    const prep = performance.now();
    execFileSync(
      "initdb",
      [
        "-D",
        pdir,
        "-U",
        "synthetic",
        "--auth-local=trust",
        "--auth-host=scram-sha-256",
        "--no-instructions",
      ],
      { stdio: "pipe" },
    );
    // Synthetic password is public benchmark configuration; not a personal credential.
    await fs.appendFile(
      path.join(pdir, "postgresql.conf"),
      `\nlisten_addresses='127.0.0.1'\nport=${ports.pg}\nwal_level=logical\nmax_replication_slots=10\nmax_wal_senders=10\nunix_socket_directories='${pgSocket}'\n`,
    );
    // Bootstrap only through this task's local socket, then normal loopback password auth.
    execFileSync("pg_ctl", ["-D", pdir, "-l", log, "-w", "start"], { stdio: "pipe" });
    pgStarted = true;
    admin = new pg.Pool({
      host: pgSocket,
      port: ports.pg,
      user: "synthetic",
      database: "postgres",
    });
    await admin.query("ALTER USER synthetic WITH PASSWORD 'synthetic-benchmark-only'");
    for (const name of ["upstream", "cvr", "change"]) await admin.query("CREATE DATABASE " + name);
    await admin.query("CHECKPOINT");
    v.services.initialized_empty_postgres = await disk(pdir);
    v.services.initialized_empty_databases = await sample(admin);
    const dbURL = (name) =>
      `postgresql://synthetic:synthetic-benchmark-only@127.0.0.1:${ports.pg}/${name}`;
    pool = new pg.Pool({ connectionString: dbURL("upstream") });
    const m = model(variant);
    for (const [name, data] of Object.entries(rows(variant, fixture))) {
      const cols = m.defs[name];
      const sqlType = (t) =>
        t.startsWith("json")
          ? "jsonb"
          : t.startsWith("number")
            ? "double precision"
            : t.startsWith("boolean")
              ? "boolean"
              : "text";
      await pool.query(
        `CREATE TABLE "${name}" (${Object.entries(cols)
          .map(([k, t]) => `"${k}" ${sqlType(t)}${t.endsWith("?") ? "" : " NOT NULL"}`)
          .join(",")},PRIMARY KEY(id))`,
      );
      for (const r of data) {
        const keys = Object.keys(cols);
        await pool.query(
          `INSERT INTO "${name}" (${keys.map((k) => '"' + k + '"').join(",")}) VALUES (${keys.map((_, i) => "$" + (i + 1)).join(",")})`,
          keys.map((k) =>
            cols[k].startsWith("json") && r[k] !== null ? JSON.stringify(r[k]) : r[k],
          ),
        );
      }
    }
    const bundle = await fs.readFile("dist/client.js");
    const dbProvider = zeroNodePg(m.schema, pool);
    api = http.createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const url = `http://127.0.0.1:${ports.api}${req.url}`;
        const request = new Request(url, {
          method: req.method,
          headers: req.headers,
          ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}),
        });
        if (new URL(url).pathname === "/api/query") {
          const reply = await handleQueryRequest({
            schema: m.schema,
            request,
            userID: await requestUserID(request),
            handler: (name, args) => mustGetQuery(m.queries, name).fn({ args }),
          });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(reply));
        } else if (new URL(url).pathname === "/api/mutate") {
          const reply = await handleMutateRequest({
            dbProvider,
            request,
            userID: await requestUserID(request),
            handler: (transact) =>
              transact((tx, name, args) => mustGetMutator(m.mutators, name).fn({ tx, args })),
          });
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(reply));
        } else if (req.url === "/client.js") {
          res.setHeader("content-type", "application/javascript");
          res.end(bundle);
        } else {
          res.setHeader("content-type", "text/html");
          res.end('<!doctype html><html><body><script src="/client.js"></script></body></html>');
        }
      } catch (e) {
        console.error("API error", e);
        res.statusCode = 500;
        res.end(String(e));
      }
    });
    await new Promise((r) => api.listen(ports.api, "127.0.0.1", r));
    let received = 0,
      sent = 0;
    const handshakes = [];
    const proxySockets = new Set();
    proxy = net.createServer((client) => {
      const upstream = net.connect(ports.cache, "127.0.0.1");
      proxySockets.add(client);
      proxySockets.add(upstream);
      let initial = Buffer.alloc(0),
        captured = false;
      upstream.on("data", (d) => {
        received += d.length;
        if (!captured) {
          initial = Buffer.concat([initial, d]);
          const i = initial.indexOf("\r\n\r\n");
          if (i >= 0) {
            handshakes.push(initial.subarray(0, i).toString());
            captured = true;
          }
        }
      });
      client.on("data", (d) => (sent += d.length));
      client.pipe(upstream);
      upstream.pipe(client);
      client.on("error", () => upstream.destroy());
      upstream.on("error", () => client.destroy());
      client.on("close", () => proxySockets.delete(client));
      upstream.on("close", () => proxySockets.delete(upstream));
    });
    await new Promise((r) => proxy.listen(ports.proxy, "127.0.0.1", r));
    cache = start(
      process.execPath,
      ["node_modules/@rocicorp/zero/out/zero/src/cli.js"],
      {
        ZERO_UPSTREAM_DB: dbURL("upstream"),
        ZERO_CVR_DB: dbURL("cvr"),
        ZERO_CHANGE_DB: dbURL("change"),
        ZERO_REPLICA_FILE: path.join(vroot, "zero.db"),
        ZERO_PORT: String(ports.cache),
        ZERO_QUERY_URL: `http://127.0.0.1:${ports.api}/api/query`,
        ZERO_MUTATE_URL: `http://127.0.0.1:${ports.api}/api/mutate`,
        ZERO_ENABLE_TELEMETRY: "false",
        DO_NOT_TRACK: "1",
        ZERO_ADMIN_PASSWORD: "synthetic-admin-benchmark-only",
        ZERO_LOG_LEVEL: "info",
        ZERO_NUM_SYNC_WORKERS: "1",
        ZERO_CHANGE_STREAMER_ADDRESS: "127.0.0.1:19443",
      },
      path.join(vroot, "zero-cache.log"),
    );
    const readinessStart = performance.now();
    for (let i = 0; ; i++) {
      if (cache.exitCode !== null)
        throw Error(
          "zero-cache exited " + cache.exitCode + "; see " + path.join(vroot, "zero-cache.log"),
        );
      try {
        const r = await fetch(`http://127.0.0.1:${ports.cache}/keepalive`, {
          signal: AbortSignal.timeout(2000),
        });
        if (r.ok) break;
      } catch {}
      if (performance.now() - readinessStart > 120000)
        throw Error("zero-cache readiness timeout after 120 seconds");
      await sleep(100);
    }
    // Use the package's own WAL2-aware SQLite implementation to verify sender readiness.
    const replica = new Database(path.join(vroot, "zero.db"), { readonly: true });
    const replicaRows = {};
    for (const [name, cols] of Object.entries(m.defs))
      replicaRows[name] = replica
        .prepare(`SELECT * FROM "${name}" ORDER BY id`)
        .all()
        .map((row) =>
          Object.fromEntries(
            Object.entries(cols).map(([k, t]) => [
              k,
              row[k] === null
                ? null
                : t.startsWith("json")
                  ? JSON.parse(row[k])
                  : t.startsWith("boolean")
                    ? !!row[k]
                    : row[k],
            ]),
          ),
        );
    v.sender_replica_verified = assertData(
      reconstruct(variant, replicaRows),
      fixture,
      "prepared sender replica",
    );
    replica.close();
    v.sender_preparation_ms = performance.now() - prep;
    v.postgres_settings = (
      await pool.query(
        "SELECT name,setting FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','wal_level','data_checksums')",
      )
    ).rows;
    v.services.pre_client_postgres_databases = await sample(admin);
    v.services.pre_client_cache_files = {};
    for (const name of await fs.readdir(vroot))
      if (name.startsWith("zero.db")) {
        const s = await fs.stat(path.join(vroot, name));
        v.services.pre_client_cache_files[name] = {
          apparent_bytes: s.size,
          allocated_bytes: s.blocks * 512,
        };
      }
    const count = Number(process.env.MEASURED || 10),
      warmups = Number(process.env.WARMUPS || 3);
    for (let index = -warmups; index < count; index++) {
      const label = index < 0 ? "warmup-" + (index + warmups + 1) : "measured-" + (index + 1),
        profile = path.join(vroot, "receivers", label);
      await fs.mkdir(profile, { recursive: true });
      const userID = "synthetic-" + variant + "-" + runID + "-" + label;
      const config = {
        variant,
        userID,
        auth: await tokenFor(userID),
        cacheURL: `http://127.0.0.1:${ports.proxy}`,
      };
      let connInfo;
      const open = async (offline = false) => {
        const startupStart = performance.now();
        ctx = await launch(profile);
        const browser_startup_ms = performance.now() - startupStart;
        const scriptStart = performance.now();
        await ctx.addInitScript(instrument);
        const p = ctx.pages()[0] || (await ctx.newPage());
        p.on("pageerror", (e) => console.error("pageerror", e));
        p.on("console", (msg) => {
          if (msg.type() === "error") console.error("browser", msg.text());
        });
        await p.goto(`http://127.0.0.1:${ports.api}`);
        await p.waitForFunction(() => !!window.bench);
        if (offline) {
          await ctx.route(`http://127.0.0.1:${ports.proxy}/**`, (route) => route.abort());
          await p.evaluate(async (c) => {
            await window.bench.open({ ...c, cacheURL: undefined });
          }, config);
        } else {
          const receiver_script_startup_ms = performance.now() - scriptStart;
          connInfo = {
            ...(await p.evaluate((c) => window.bench.open(c), config)),
            browser_startup_ms,
            receiver_script_startup_ms,
          };
        }
        return p;
      };
      let page = await open();
      await page.evaluate(() => window.bench.close());
      await ctx.close();
      ctx = null;
      const baseline = await receiverDisk(profile);
      page = await open();
      const conn = await page.evaluate(() => ({ idbName: window.idbName }));
      const before = { received, sent };
      const metrics = await page.evaluate(() => window.bench.sync());
      const transport = { received: received - before.received, sent: sent - before.sent };
      const correctness = assertData(
        await page.evaluate(() => window.bench.snapshot()),
        fixture,
        "initial",
      );
      await page.evaluate(() => window.bench.close());
      await ctx.close();
      ctx = null;
      const total = await receiverDisk(profile);
      // Reopen browser using same native receiver, prevent any cache connection, read local ZQL only.
      ctx = await launch(profile);
      await ctx.addInitScript(instrument);
      page = ctx.pages()[0];
      await page.goto(`http://127.0.0.1:${ports.api}`);
      await page.waitForFunction(() => !!window.bench);
      await ctx.route(`http://127.0.0.1:${ports.proxy}/**`, (r) => r.abort());
      // Offline opens cannot become connected: constructor readiness is awaited via local reads instead.
      await page.evaluate(async (c) => window.bench.openOffline(c), config);
      const reopened = assertData(
        await page.evaluate(() => window.bench.offlineRead()),
        fixture,
        "offline initial reopen",
      );
      await page.evaluate(() => window.bench.close());
      await ctx.close();
      ctx = null;
      const row = {
        label,
        measured: index >= 0,
        connection: connInfo,
        ...metrics,
        transport_bytes: transport,
        receiver_storage: { baseline, total, net: netGrowth(baseline, total) },
        correctness,
        reopened,
      };
      v.runs.push(row);
      await save();
      console.log(
        JSON.stringify({
          variant,
          label,
          readable_ms: metrics.readable_ms,
          persistence_transaction_ms: metrics.persistence_transaction_ms,
          wire: metrics.wire.received,
          verified: reopened.verified,
        }),
      );
    }
    // One stable receiver for sequential sender changes; restore fixture was never altered above.
    const profile = path.join(vroot, "receivers", "incremental");
    ctx = await launch(profile);
    await ctx.addInitScript(instrument);
    let page = ctx.pages()[0];
    await page.goto(`http://127.0.0.1:${ports.api}`);
    await page.waitForFunction(() => !!window.bench);
    await page.evaluate((c) => window.bench.open(c), {
      variant,
      userID: "synthetic-incremental-" + runID,
      auth: await tokenFor("synthetic-incremental-" + runID),
      cacheURL: `http://127.0.0.1:${ports.proxy}`,
    });
    await page.evaluate(() => window.bench.sync());
    const expected = structuredClone(fixture);
    v.updates = [];
    for (const [collection, field, marker] of [
      ["issues", "title", "SYNTHETIC-TITLE-UPDATE-44"],
      ["notes", "body", "SYNTHETIC-BODY-UPDATE-44"],
    ]) {
      const old = expected[collection][0][field],
        value = old + " " + marker;
      expected[collection][0][field] = value;
      await page.evaluate((marker) => window.bench.armUpdate(marker), marker);
      const before = { received, sent };
      const t = performance.now();
      if (variant === "typed")
        await pool.query(`UPDATE "${collection}" SET "${field}"=$1 WHERE id=$2`, [
          value,
          expected[collection][0].id,
        ]);
      else if (variant === "record")
        await pool.query(`UPDATE "${collection}" SET data=$1 WHERE id=$2`, [
          JSON.stringify(expected[collection][0]),
          expected[collection][0].id,
        ]);
      else
        await pool.query("UPDATE collections SET data=$1 WHERE id=$2", [
          JSON.stringify(expected[collection]),
          collection,
        ]);
      const sender_commit_ms = performance.now() - t;
      const metric = await page.evaluate(
        ({ collection, field, value }) => window.bench.waitUpdate(collection, field, value),
        { collection, field, value },
      );
      v.updates.push({
        collection,
        field,
        source_added_bytes: Buffer.byteLength(value) - Buffer.byteLength(old),
        source_new_field_bytes: Buffer.byteLength(value),
        sender_commit_ms,
        ...metric,
        transport_bytes: { received: received - before.received, sent: sent - before.sent },
        correctness: assertData(
          await page.evaluate(() => window.bench.snapshot()),
          expected,
          "update " + field,
        ),
      });
      await save();
    }
    await page.evaluate(() => window.bench.close());
    await ctx.close();
    ctx = null;
    ctx = await launch(profile);
    await ctx.addInitScript(instrument);
    page = ctx.pages()[0];
    await page.goto(`http://127.0.0.1:${ports.api}`);
    await page.waitForFunction(() => !!window.bench);
    await ctx.route(`http://127.0.0.1:${ports.proxy}/**`, (r) => r.abort());
    await page.evaluate((c) => window.bench.openOffline(c), {
      variant,
      userID: "synthetic-incremental-" + runID,
    });
    v.incremental_reopened = assertData(
      await page.evaluate(() => window.bench.offlineRead()),
      expected,
      "incremental offline reopen",
    );
    await page.evaluate(() => window.bench.close());
    await ctx.close();
    ctx = null;
    v.handshakes = handshakes.slice(0, 2);
    await stop(cache);
    cache = null;
    await admin.query("CHECKPOINT");
    v.services.final_databases = await sample(admin);
    await pool.end();
    pool = null;
    await admin.end();
    admin = null;
    execFileSync("pg_ctl", ["-D", pdir, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
    pgStarted = false;
    v.services.final_postgres = await disk(pdir);
    v.services.postgres_net = netGrowth(
      v.services.initialized_empty_postgres,
      v.services.final_postgres,
    );
    v.services.cache_files = {};
    for (const name of await fs.readdir(vroot))
      if (name.startsWith("zero.db")) {
        const s = await fs.stat(path.join(vroot, name));
        v.services.cache_files[name] = { apparent_bytes: s.size, allocated_bytes: s.blocks * 512 };
      }
    const measured = v.runs.filter((r) => r.measured);
    const stats = (xs) => {
      xs.sort((a, b) => a - b);
      return {
        n: xs.length,
        p50:
          xs.length % 2 ? xs[(xs.length - 1) / 2] : (xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2,
        p95_nearest_rank: xs[Math.ceil(xs.length * 0.95) - 1],
        max: xs.at(-1),
      };
    };
    v.summary = {
      readable_ms: stats(measured.map((r) => r.readable_ms)),
      persistence_transaction_ms: stats(measured.map((r) => r.persistence_transaction_ms)),
      received_application_bytes: stats(measured.map((r) => r.wire.received)),
      received_transport_bytes: stats(measured.map((r) => r.transport_bytes.received)),
    };
    v.status = "complete";
    results.environment.browser = await (async () => {
      const c = await chromium.launch({ executablePath, headless: true });
      const version = c.version();
      await c.close();
      return version;
    })();
  } catch (e) {
    v.status = "blocked";
    v.error = String(e.stack || e);
    console.error(e);
  } finally {
    if (ctx) await ctx.close().catch(() => {});
    await stop(cache);
    if (proxy) {
      proxy.close();
    }
    if (api) api.close();
    if (pool) await pool.end().catch(() => {});
    if (admin) await admin.end().catch(() => {});
    if (pgStarted)
      try {
        execFileSync("pg_ctl", ["-D", pdir, "-w", "stop", "-m", "fast"], { stdio: "pipe" });
      } catch {}
    await save();
  }
}
results.finished_utc = new Date().toISOString();
await save();
console.log("Results " + resultFile);
if (results.variants.some((v) => v.status !== "complete")) process.exitCode = 1;
