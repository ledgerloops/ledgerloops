# Replicache methodology and persistence audit

Read-only audit, 2026-10-27. No builds, engine/data imports, browser launches,
benchmark reruns, GitHub changes, or messages to other chats were performed.
Original artifacts and all numerical measurements are preserved.

**Finding:** the published benchmark already includes a background-persistence
measurement. For the record model, initial observable p50 is **14.35 ms**, public
pull completion p50 **14.50 ms**, and the internal post-persist notification p50
**25.40 ms**. The last number is a useful default-persistence milestone, not an
OS fsync or power-loss guarantee. A single universal “sync + durable persistence”
ranking would conceal materially different acknowledgement guarantees.

Audit basis: comparison snapshot
[`104eb59e4ef50b4375413dc4192083c5f0c4b0b3`](https://github.com/ledgerloops/ledgerloops/tree/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/replicache/2026-10-26),
Replicache npm **15.3.0**, source commit
[`8684fb19c032e25f7f166f40e8acdfb179e6ca87`](https://github.com/rocicorp/mono/tree/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src).
Published browser.js/model.js match the measured originals; publication runner
changes are documented path adaptations. New evidence, paired timing calculations,
source blob hashes, and cache inventory are in
`replicache-persistence-audit-2026-10-27.json` beside this report.

## 1. What the published run actually persists

Each model has 3 warmups and 10 measured fresh persistent receiver profiles.
Every receiver performs full initial pull, issue-title change, then note-body
change. There are 117 phase-level full-content checks after normal browser
close/reopen, including warmups. Replication is blocked during reopened reads;
subsequent pull cookies also confirm that the prior version metadata survived.
The entire canonical fixture, including nested values and nulls, is checked.

The receiver uses the official client with `kvStore: 'idb'`, not a memory store.
Its persistent state includes the client view's B-tree/DAG chunks, snapshot and
cookie metadata, client/client-group information, mutation bookkeeping, chunk
references/refcounts, and the database/profile registry. No application secondary
indexes are configured (`indexes: {}`). No local mutations, push round trips,
conflicting edits, unacknowledged local history, or recovery/rebase workload are
exercised. This is an authoritative-view download and subsequent downstream patch
test, not a full operation-history migration.

After each notification the harness checks the full live view, calls `rep.close()`,
stops the browser, measures files, reopens the same profile and verifies content
with pulling blocked. Thus **normal graceful restart correctness is tested**;
abrupt process termination at the notification instant and OS/power failure are
not. Graceful shutdown can itself allow more browser/OS flushing after the timed
notification. The verification operation has no published restart-completion
latency endpoint. All published `durable_ms` values correctly remain null.
[Published browser instrumentation](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/replicache/2026-10-26/browser.js#L9-L68),
[runner lifecycle and verification](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/replicache/2026-10-26/runner.mjs#L134-L182).

## 2. Exact completion and durability boundaries

| Boundary | What is established | Published observation / limitation |
|---|---|---|
| Observable full view | Subscription reads the complete memory-backed client view and sees the expected phase suffix. Full canonical equality is checked outside timing. | `observable_ms`; not persistent-store completion. |
| `await rep.pull({now:true})` | Pull/rebase and subscription delivery finish; persistence is scheduled afterward. | `pull_ms`; no persistence/flush promise. |
| Native persistent-store commit | `persistDD31` writes chunks and client-group state through a persistent-store transaction; the default IDB implementation resolves nonempty writes on `transaction.oncomplete`. | No direct native commit timestamp was captured. The notification is later than this callback on the successful path. |
| Post-persist notification | Internal `replicache-on-persist:<name>` BroadcastChannel is emitted after persistence returns and memory chunk bookkeeping is updated. | `persistence_notification_ms`; includes event dispatch and bookkeeping, is internal/version-specific, and carries client/group IDs rather than a target cookie/hash. |
| Normal restart | Full expected data is readable after closing the client/browser and reopening without replication. | All 117 checks passed, outside timer. Not an abrupt-crash acknowledgement at the notification timestamp. |
| Explicit OS fsync / power-loss barrier | No such acknowledgement is exposed by the supported public `Replicache` API in this pinned release. | Unmeasured/unavailable, not zero. Neither IDB completion nor successful normal reopen supplies it. |

The native store explicitly uses `{durability: 'relaxed'}`. IndexedDB's relaxed
hint permits transaction completion without verifying persistent-media flush;
`strict` is a stronger browser durability hint, not a direct observable fsync
syscall API. Neither should be silently equated with a different engine's
fsync acknowledgement or SQLite NORMAL commit.
[Pinned IDB store](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/kv/idb-store.ts#L142-L174),
[IndexedDB durability semantics](https://w3c.github.io/IndexedDB/#transaction-durability-hint).

The successful persistence chain is concrete: `persistDD31` gathers the new
snapshot's memory-only chunks, writes the chunks and client state, updates the
client group's head and acknowledgement maps, and awaits the persistent
transaction. DAG commit also updates refcounts before awaiting the KV commit.
The outer `persist()` then emits its notification.
[Persistence](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/persist/persist.ts#L103-L237),
[DAG commit](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/dag/store-impl.ts#L184-L191),
[notification after persist](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache-impl.ts#L1136-L1171).

The message is **not a universal target-specific success certificate**. Its payload
only contains client/group IDs. Persistence has no-op/close paths, and the outer
method handles some client-state/closing errors before the notification code.
The published harness filters the client ID and serializes phases, sees one event
per measured phase, and verifies exact content after reopening. A future rapid
multi-update experiment must not assume the next message certifies each edit.
[Channel schema and emission](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/on-persist-channel.ts#L9-L50).

### Normal close does not flush the staged view

Public `Replicache.close()` delegates to the implementation. That implementation
marks the client closed, aborts scheduled processes, waits for initialization,
closes the memory DAG, persistent DAG and registry stores, and clears connections
and subscriptions. It does **not** call `persist()` or await a drain of all
scheduled persistence work. The memory DAG close is a no-op. The IDB store calls
native `db.close()` and returns; that native method requests connection closure,
whose outstanding transactions finish asynchronously. No final flush acknowledgement
is added by the SDK close promise.
[Close implementation](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache-impl.ts#L690-L716),
[memory close](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/dag/lazy-store.ts#L189-L191),
[IDB close](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/kv/idb-store.ts#L31-L36),
[standard connection-close steps](https://w3c.github.io/IndexedDB/#closing-a-database-connection).

### Public StoreProvider option

`ReplicacheOptions.kvStore` accepts `'idb'`, `'mem'`, or a `StoreProvider` with
`create`/`drop`. Its transaction interface has `read`, `write`, `commit`, `release`
and `close`; the required isolation is strict serializability. That consistency
requirement does not imply storage-media durability. The default provider cannot
be configured to `strict` through a public durability flag. A custom provider
can implement/observe its own commit semantics, but it still receives writes
only when Replicache's background persistence runs. Committing an empty custom
transaction does not flush the client's staged memory DAG.

A strict-IDB or fsync-backed custom provider would be an explicitly named
additional storage/durability variant, not an unnoticed replacement for the
default baseline. `ReplicacheImpl.persist()` exists in the internal implementation;
it is not `Replicache.persist()` and is not a supported public flush barrier to
use for the primary comparison.
[Public option](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache-options.ts#L204-L212),
[provider contract](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/kv/store.ts#L3-L80),
[default provider selection](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache.ts#L476-L494).

`navigator.storage.persisted()` was false for every receiver initialization.
No eviction-resistant permission was requested. That flag concerns browser storage
retention/eviction, a separate issue from transaction commit and media flush.

## 3. Why approximately 14 ms becomes approximately 25 ms

Reanalysis of existing measured samples only; no new timings were taken:

| Model, initial sync, n=10 | Observable p50 ms | Pull p50 ms | Notification p50 ms | Paired notification-minus-observable median ms |
|---|---:|---:|---:|---:|
| 132 records | 14.35 | 14.50 | 25.40 | 11.20 |
| Records + shared keys | 14.65 | 14.80 | 25.60 | 10.95 |
| Two collections | 6.35 | 6.45 | 16.15 | 9.35 |

The last column is the median of per-run differences; it is not a subtraction
of independently calculated medians. The record-model paired gap ranges
10.10–13.70 ms. Native DB commit, idle wait and notification dispatch were not
separately timestamped, so **the gap cannot be assigned entirely to disk I/O**.

Architecture explains the two stages: Replicache first applies/rebases in its
memory DAG and fires subscriptions, then schedules persistence. The latter
gathers the snapshot, writes persistent DAG/refcount metadata, commits IDB,
updates memory bookkeeping, and posts the notification. The adapter's observable
endpoint also includes full-view scanning/reconstruction in the subscription.
[Pull completion ordering](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache-impl.ts#L719-L743).

Default persistence is debounced and throttled: a 1000 ms idle timeout and
500 ms minimum interval between process starts. In Chrome it uses
`requestIdleCallback`; the 1000 ms is a timeout, not a mandatory sleep. The first
throttle promise is already resolved, so the first persist need not wait 500 ms.
The measured ~11 ms gap includes whatever idle scheduling occurred under that
headless browser/load; it does not identify its individual components.
[Scheduler](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/process-scheduler.ts#L13-L95),
[default constants](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache-impl.ts#L138-L142),
[idle request](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/request-idle.ts#L11-L17).

**Important adapter limitation:** the harness closes/reopens the browser/client
after *every* phase. Every incremental pull therefore starts in a newly constructed
client with a reset persistence scheduler. It is open and subscribed before the
next edit, but it is not the same continuously open instance. The published
~12 ms incremental notification times do not measure the 500 ms batching behavior
of rapid successive edits in one live client. Close/reopen also creates additional
client metadata in the disk totals. This behavior must be explicit in a comparison.

Other timing choices: polling is disabled with `pullInterval: null` (normal
default is 60 seconds); `pull({now:true})` bypasses request-delay/backoff scheduling
(the connection-loop minimum delay is 30 ms), but does not bypass background
persistence. The timer starts before this explicit pull, after empty receiver
initialization and an authenticated HTTP readiness request. It excludes server edit
preparation and server-to-client notification/poll discovery time. HTTP preflight
occurred, but socket reuse was not separately proved by connection IDs.
[Explicit-pull semantics](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache.ts#L346-L361).

## 4. Bytes, history, storage, and topology differences

The topology is native Node 26.8.1 app server → HTTP/1.1 loopback → headless
Chrome 155.0.8059.85 renderer/IndexedDB browser process, driven by Playwright
1.64.1. Multiple process and IPC boundaries are included; browser startup is not.
The server validates a fixed synthetic Authorization value, protocol version,
schema and cookie. There is no TLS, expensive login, signatures, per-record proof
chain, multi-user ACL filtering, or authentication service in this run.

The **application server** precomputes all three complete views and cookie-specific
patch response strings outside timing. Initial pull is `clear` plus every key;
incremental pull is a `put` for the changed key. No SQL query, dynamic view diff,
authoritative mutation execution, server persistence or server fsync is in the
transfer timer. This is a valid minimal Replicache server, but materially less
work than sending an engine-owned historical log or calculating a view on request.
Some in-timer server logging even parses the prepared response to record its key
list. The separate 2.5–3.4 MB service files are three view versions plus a prepared
response cache, an adapter cost rather than an irreducible Replicache history size.
[Server and preparation](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/replicache/2026-10-26/runner.mjs#L35-L58),
[cached views and patches](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/replicache/2026-10-26/runner.mjs#L118-L133).

Replicache's receiver still has its own DAG/snapshot bookkeeping and native logs.
However, old unreferenced chunks can be removed by refcount GC; retaining a
current view is not equivalent to retaining an immutable CRDT/event history.
No explicit compaction was requested, while normal engine/browser maintenance
remains possible. [Refcount cleanup](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/dag/store-impl.ts#L217-L237).

Wire compression is absent (`identity`). Exact response JSON-body bytes were
matched by CDP for every phase; headers and TCP/IP framing are not in those body
counts. Initial responses are 421,208 / 415,367 / 415,587 bytes for record/shared/
collection variants. A `put` sends the entire value for its key. The collection
variant sends 83,346 title-update bytes and 332,329 note-update bytes, versus
3,728 and 3,064 for records. That is key/value granularity, not fine-grained
property replication. Shared-object splitting changes application JSON layout.

On-disk serialization/compression is a separate layer from HTTP compression.
Chrome documents transparent IndexedDB/large-value compression; two large values
can take a different storage path from many B-tree chunks. That is a plausible
contributor to the collection variant's 145,750-byte apparent initial IDB total,
compared with 483,071 for records. The run did not trace the Chrome 155 codec or
compression thresholds; assigning the entire reduction to a specific codec or
to Replicache itself would exceed the evidence.
[Chrome's storage explanation](https://developer.chrome.com/docs/chromium/indexeddb-storage-improvements).

Disk totals include **every file under `Default/IndexedDB`** in the dedicated
profile: origin LevelDB, WAL/logs/manifests, large-value files if present, and
Replicache registry DB metadata. Apparent and allocated file bytes, initialized-empty
baseline, actual total, and net are retained. The baseline precedes a second client
open; incremental totals also include prior history and reopen/client metadata.
`navigator.storage.estimate()` is recorded independently and is not a precise
allocated-file metric.

**Exclusion requiring comparability care:** browser-global quota infrastructure
outside that subtree is not counted. A read-only spot check of the retained record-0
profile finds `Default/WebStorage/QuotaManager` at 40,960 apparent bytes and its
zero-length journal. This is present-day evidence, not a saved per-phase baseline
or a number to add retroactively to all runs. Dedicated profile quota files could
be reported as separate browser-storage overhead in a supplement. Whole profiles,
browser caches/executables, dependencies and builds should still be excluded.

## 5. Exact edits, reset/history and convergence limitations

The published sequence is **append, not replacement or one-digit editing**:

1. Version 1: exact synthetic fixture, SHA-256
   `9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a`.
2. Version 2: `issue-000.title` gains exactly ` [synthetic title update]`
   (25 UTF-8 bytes). No timestamp or other field changes. Full-view hash is
   `07b53f553c0a73c02d055900081f3cc4222d0abdc9805434b2e37fcfad84f334`.
3. Version 3: keep the changed title and append exactly
   ` [synthetic note body update]` to `note-000.body` (29 bytes). Full-view hash is
   `39a16bc4103bb16fc02a2992537ae75d2bd2cfc5e997f3014126b5644ddfefc7`.

Each repetition resets the server's active version and uses a completely fresh
profile. Between phases there is no content reset: persisted data/cookie advance
1→2→3, while the browser/client is recreated for verification. A null cookie on
the first request and preceding-version cookies on incremental pulls are asserted.
There is one writer and no concurrent editing, conflict resolution, independently
authored replica convergence, deletion, offline replay or history catch-up test.
[Exact change code](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/replicache/2026-10-26/model.js#L59-L69).

Before comparing update bytes, freeze the same complete title/body strings,
record IDs, order, field/timestamp rules, and full-state hashes at every step.
Specify whether each next edit follows a committed checkpoint or can arrive while
the prior one is still batching. Replacements and one-character edits can have
different document sizes, entropy, operation encodings and retained histories;
they are not interchangeable with these appends. Exact before/after field lengths
and hashes are in the audit JSON.

## 6. Contention and why small latency rankings are not supported

Historically, this worker used the shared atomic directory lock for sustained work
and yielded to Atomic Model H. That serializes participating commands; it does not
isolate the host from other services, leftover processes, memory pressure or I/O.
The original run recorded one-minute load averages 19.1–55.5 on 10 logical CPUs,
99% APFS capacity used in the first two batches, and substantial time gaps between
variant batches. Load average is not CPU-busy percentage; those observations must
not be converted into equivalent CPU utilization.

The coordinating chat relayed a **2026-10-27 10:34 Europe/Amsterdam** observation:
39% aggregate CPU busy across 10 cores, 15 GB / 16 GB RAM used, 6.9 GB compressed,
and no shared measurement lock. This is the coordinator's snapshot, not a new
measurement by this audit. Compressed memory should not be added again to the
reported RAM-used total. The snapshot confirms that an absent benchmark lock is
not evidence of an idle, memory-uncontended machine. **No timings should be taken
under that pressure.**

In particular, 14.35 versus 14.65 ms is not a defensible ranking: n=10, overlapping
samples, different sequential run windows, and no randomized/interleaved repeats.
The p95 estimate is the sample maximum. The larger collection/layout differences
have architectural explanations but their exact speedup is not isolated from
browser/runtime and host effects. Cross-engine results also span different
native/browser/runtime boundaries and persistence guarantees. Adding each engine's
unqualified “persist” number cannot fix those differences.

## 7. Smallest useful supplement — proposed, not authorized or run

**No rerun is needed simply to include persistence:** retain the original data and
show both observable and default persistence-notification columns, with their
guarantee tiers. Native commit and fsync columns remain unavailable where unobserved.

Once the coordinator freezes the common edit sequence and permits work on an
adequately quiet host, the smallest new diagnostic is **one record-model fresh
receiver with initial pull and the two agreed edits in the same continuously open
client**, without reopening between edits. Keep the pinned public client, normal
IDB store/durability, explicit pull policy and whole-view verification. After each
agreed checkpoint, verify by an independent reopened public client with pulling
disabled outside the transfer timer. A paired replay can restore the old
close/reopen-between-edits lifecycle to isolate scheduler-reset effects. Full
comparison repeats would then use the shared 3-warmup/10-measured contract rather
than rank the diagnostic's single samples.

Add passive tracing through **standard browser IndexedDB APIs**: preserve the
exact `IDBDatabase.transaction` arguments and return value; attach `complete`,
`abort` and error listeners; log transaction creation/completion time, DB name,
mode and `tx.durability`. Record all relevant readwrite completions between pull
and notification. This observes public native events without forcing a flush,
altering durability or accessing private Replicache fields. Correlate the target
payload transaction using the pinned successful persistence path and isolated
writer; if multiple candidate transactions cannot be disambiguated, retain that
ambiguity instead of labeling an arbitrary completion a target barrier. Keep the
existing internal message as an explicitly internal auxiliary observation, not a
supported SDK acknowledgement.

This can separate native completion-callback time from later message delivery,
but cannot reveal the precise OS write/fsync instant. Avoid inserting forced
persist calls or an empty “strict” transaction as a supposed full-client flush.
A public-`StoreProvider` instrumentation/strict variant is possible if necessary,
but implementing a different provider changes the storage adapter and must be
labeled separately, with its strict-serializability contract preserved.

An optional abrupt-process-termination/recovery test at a defined boundary would
answer a stronger question than the published graceful reopen, while remaining
distinct from an OS crash/power-loss test. It needs separate authorization and
must not be presented as a latency optimization or an fsync proof.

## 8. Cached assets and future prerequisites

The following still exist; none were launched or imported by the audit:

* Original fixture, source, lockfile, results and report:
  `$HOME/Documents/Codex/2026-10-26/sync-benchmark-replicache/outputs/replicache-benchmark/`.
* Cached Replicache 15.3.0, Playwright 1.64.1 and esbuild 0.25.12 under that
  directory's `node_modules/`; npm tarball under the task's `work/`.
* Original 172,941-byte bundled browser client:
  `$HOME/Documents/Codex/2026-10-26/sync-benchmark-replicache/work/receiver.js`.
* `/private/tmp/sync-benchmark-replicache-20261026-01a176de/` retains all
  **13 profiles per model**, plus task-owned prepared service data. Do not reuse
  these as fresh receivers or modify them for a supplemental run.
* Published-copy checkout under the task's `work/ledgerloops-publish/` is an older
  local publication branch; the audit independently fetched the stated comparison
  snapshot's adapter files and recorded their blob hashes. Pinned SDK source copies
  and a source manifest are cached under the task's `work/audit-source/`.

**Browser prerequisite:** the measured Chrome was **155.0.8059.85**. Reading the
installed app's Info.plist now gives **156.0.8078.48**. The old executable was not
downloaded into this task and its availability has not been established. Either
obtain the exact old binary for a historical reproduction, or pin and disclose a
new common browser/runtime for the coordinated comparison. Do not silently reuse
the current installed browser and call it the original environment.

Any future sustained build/import/run must acquire, record ownership of, and
release only its own shared atomic lock at:
`$HOME/Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock`.
The pressure constraint and pending shared contract take precedence over mere
lock availability. This audit acquired no heavy-work slot and requests no rerun now.
