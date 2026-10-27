# Atomic Model H fairness and persistence audit

Audit date: 2026-10-27 (Europe/Amsterdam). Scope: read-only examination of the published Model H benchmark, its adapter, and pinned engine/dependency source. No builds, imports, benchmark reruns, engine edits, or GitHub publication were performed for this audit. Original measurements and artifacts are preserved.

**Prominent qualification — SOURCE-INFERRED / UNREPRODUCED:** the pinned `RedbStore::flush` implementation permits a possible concurrent-flush acknowledgment race. This audit did not reproduce the race and does not establish that it occurred in any measured run. The existing timings measure return from the native import/flush API, with normal reopen verification; they do not independently establish that a covering OS sync completed before every recorded timestamp. Details and exact references follow below.

## Provenance and evidence

- Engine: `ontola/atomic-server` commit `396f0da075bd514e2c46b2fa33a575b35c14b2a6`.
- Published comparison snapshot: `ledgerloops/ledgerloops` commit `104eb59e4ef50b4375413dc4192083c5f0c4b0b3`.
- All 180 copied runtime library files were checked against the Git blob hashes in [source-provenance.json](source-provenance.json), with zero mismatches. The published harness at the comparison snapshot matched the local publication copy.
- Fixture: 415,448 bytes; SHA-256 `9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a`.
- Evidence: [published report](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/atomic/2026-10-26/REPORT.md), [initial results](model-h-20261026T063214Z/results.json), [incremental results](model-h-20261026T063214Z/incremental.json), and [adapter](harness/src/main.rs).

## 1. What is already persisted

The initial **379.897 ms median** measures SYNC request through successful return from the LAST `import_sync_push`. Each chunk commits materialized resource rows, Loro snapshots, reference indexes, registered table-query indexes, and full-text indexes. Retained signed envelopes are subsequently verified and stored. LAST invokes `Db::flush` and propagates its error.

All 13 transfers (three warmups, ten measurements) passed complete fixture reconstruction and native resource, CRDT deep-state/version-vector, envelope-signature-list, table-membership, and search-document/posting comparisons after normal reopening. This establishes the observed reopen correctness, not abrupt-process-death or power-loss survival at the measured timestamp. Source verification compares CRDT state and causal vectors rather than byte-identical snapshot serialization.

The **413.216854 ms median readable confirmation** includes full fixture reconstruction after import returned. It is an observation upper bound, not the earliest readable instant. The recorded `earlierReadableMs` remains null.

Exact references:

- [Harness lines 394–475: import, timestamp, verification, reopen](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/atomic/2026-10-26/outputs/harness/src/main.rs#L394).
- [Harness lines 69–154: comparison scope](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/atomic/2026-10-26/outputs/harness/src/main.rs#L69).
- [Engine lines 2097–2131: projection, notifications, envelopes, LAST flush](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/sync/engine.rs#L2097).

## 2. Visibility, native commits, restart, and OS durability

Ordinary redb batches explicitly use `Durability::None`. Their successful commit exposes the transaction to readers without acknowledging an OS durability barrier. Atomic's flush creates a nonempty sentinel transaction, leaves redb's default `Immediate` durability in place, enables quick repair, and commits. redb 4.1.0 documents Immediate persistence upon commit return; quick repair enables two-phase commit, and the native file backend calls Rust `File::sync_data()`.

These are software/OS persistence semantics, subject to filesystem/device behavior. They are not physical power-loss test results. A clean drop/reopen is also insufficient to prove durability at an earlier timestamp: the pinned engine's own crash-test commentary notes that clean redb close makes writes durable.

### SOURCE-INFERRED / UNREPRODUCED possible flush race

`RedbStore::flush` clears `dirty` using `swap(false)` at line 574, before acquiring the redb write transaction at lines 585–588 or completing its Immediate commit at line 603. A second caller can see `dirty == false` and return at line 575 while the first caller is still committing. A normal file-backed Db automatically runs a 100 ms periodic flush thread, so this is a possible interleaving in the published configuration:

1. Last relevant writes have committed with `Durability::None`; `dirty` is true.
2. Periodic flush clears the flag and starts, but has not completed its Immediate commit.
3. LAST import calls `flush`, sees false, and returns without waiting for the in-progress flush.
4. The adapter records completion; the other flush may finish later.

This is source reasoning, not a reproduced failure or evidence that recorded data was lost. The public API exposes neither a durable generation nor an awaitable in-progress-flush completion. Keep the existing numbers, but describe the boundary as **request to native LAST-import/flush return; normal reopen verified**. Do not claim unconditional per-run fsync acknowledgment from those timestamps alone. A separately authorized reproduction or instrumentation is needed before concluding how this affects observed timings.

Exact references:

- [redb adapter lines 536–566: None commit](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db/redb_store.rs#L536).
- [redb adapter lines 570–607: dirty flag and Immediate sentinel commit](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db/redb_store.rs#L570).
- [Db line 411: 100 ms interval](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db.rs#L411); [lines 1346–1347: automatic thread startup](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db.rs#L1346); [lines 1377–1400: periodic flush implementation](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db.rs#L1377).
- [Existing crash-test source, lines 735–777](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db/redb_store.rs#L735). Read only; not executed in this audit.
- Inspected local redb 4.1.0 dependency source: `/private/tmp/atomic-sync-model-h-yjgxp2e7/cargo-home/registry/src/index.crates.io-1949cf8c6b5b557f/redb-4.1.0/src/transactions.rs`, lines 362–368 (durability), 1265 (default), 1287–1341 (two-phase commit and quick repair); `src/tree_store/page_store/file_backend/optimized.rs`, lines 88–89 (`File::sync_data`). Online docs retrieval failed; these claims use the inspected pinned local dependency source.

## 3. Observable initial readability without engine changes

Each chunk's projection transaction includes resource rows, snapshots, reference indexes, watched-query indexes, and full-text indexes. Import uses `defer_search=false`. After committing, `finish_replicated_resources` emits public `DbEvent::Changed` notifications. These precede envelope ingestion and LAST flush.

A concurrent observer can subscribe with `Db::subscribe_events`, then confirm an agreed predicate through public resource and table/search queries. This qualifies the original report's broad “unobservable” wording: the awaited import function offers no separate pre-flush return/callback, but an external observation is possible without engine changes.

Such a timestamp measures when the observer confirms readability, including scheduling and query costs. It is not the exact transaction commit instant; it may occur after a periodic flush or even after import returns. A changed event alone does not prove all rows/indexes have arrived, nor that all signed envelopes have been stored. Record only what the predicate actually confirms. Do not clear LAST, defer indexing, or disable periodic flushing to manufacture a primary pre-flush number.

Exact references: [Db lines 885–941: projection commit and change notifications](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db.rs#L885), [lines 1103–1140: indexes and snapshot](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db.rs#L1103), [lines 2916–2919: public event subscription](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db.rs#L2916).

## 4. Scope and adapter choices explaining differences

| Dimension | Atomic Model H measurement |
| --- | --- |
| Application data | 132 payload resources: 21 issues and 111 notes; 30 comments and 273 checklist items embedded |
| Additional replicated resources | 20 properties, two classes, five containers; 159 resources total |
| Initial application-protocol bytes | 2,867,466: 1,158,957 Loro snapshots, 1,661,318 retained-envelope JSON, 47,191 protocol metadata |
| History | Full Loro snapshots, not shallow state-only snapshots; 159 retained initial signed envelopes |
| Envelope retention | Default Latest, not unlimited signed audit history; retained envelopes and Loro operation history are distinct |
| Batching | Native limit 100 entries / approximately 1 MiB per chunk; three observed chunks. Projection batched per chunk, envelopes verified/stored subsequently and individually |
| Compression | Native Loro encoding; no negotiated WebSocket compression. Native storage deflate for resource/snapshot/envelope values remains enabled |
| Receiver storage | Median 10,285,056 allocated bytes total; 2,060,288 baseline; 8,224,768 net growth. Apparent total 16,846,848 bytes |
| Index scope | Reference indexes, 132 registered table-query memberships, full-text indexes, plus initialized built-ins |
| Timing/topology | Native release Rust adapter, two Tokio workers, same-process Db instances over loopback TCP/WebSockets; persistent fresh receivers |
| Preparation excluded | Receiver open/setup and authentication; sender's authorized native response precomputed and cached |
| Work included | Receiver admission checks, CRDT import/materialization, indexes, envelope validation/storage, native compression and persistence path |
| Storage policy | Startup compaction explicitly disabled; allocated and apparent filesystem bytes reported separately |

Unlike a cached materialized-view transfer, these bytes include causal state, signature-bearing envelopes (including encoded Loro updates), schema and container resources. The 6.90× ratio to canonical fixture bytes does not measure transport inefficiency for equivalent responsibilities.

Logical KV byte totals are decoded logical bytes, not physical storage. The source has 159 extra signed commit materializations and can reconstruct some snapshots relative to those genesis rows. The receiver stores retained envelopes separately and may use whole snapshots when the commit row needed for that storage optimization is absent. Thus even equal apparent file sizes do not imply equal physical layouts.

From existing measurements only: median import time is **378.5066665 ms**, socket-wait time **1.107479 ms**, and LAST-chunk time **119.011354 ms**. These are not independent CPU/IO/fsync decompositions; LAST includes import and envelope work. Individual medians need not sum to the overall median.

Exact references:

- [Protocol lines 446–447: limits](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/sync/protocol.rs#L446); [lines 985–1035: envelope-aware chunking](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/sync/protocol.rs#L985).
- [Loro lines 182–198: full versus shallow snapshots](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/loro.rs#L182).
- [Envelopes lines 33–43: default retention](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/envelopes.rs#L33); [lines 630–690: verification/storage](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/envelopes.rs#L630).
- [Compressed KV lines 1–75: representations and codec](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db/compressed_kv.rs#L1).
- [Harness lines 37–44: compaction policy](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/atomic/2026-10-26/outputs/harness/src/main.rs#L37); lines 156–365 cover runtime, prepared response, auth, and receiver setup in the same file.

## 5. Incremental scope, reset, and convergence limitations

The original sequence is exactly:

1. Replace `issues[0].title` with `Synthetic changed issue title`.
2. Set `notes[0].body` to its original fixture value followed by the literal suffix ` Synthetic incremental edit.`.

Both operations call scalar `set` and `save`. The body is logically appended but represented as replacement of a scalar Markdown property, not an in-place text CRDT edit. There is one observation per field. Recorded `oldFieldBytes` and `newFieldBytes` count JSON serialization, including quotes/escaping, not raw UTF-8 text length. Published incremental results are 293 / 2,877 application bytes, 6.203375 / 5.29375 ms readable, and 25.650959 / 21.408541 ms to explicit receiver flush return.

Live UPDATE has CRDT state but no newly signed envelope. The receiver's incremental persistence timing therefore covers resource/snapshot/index state, not new-envelope convergence. Matching CRDT hashes can return SYNC_OK without envelope transfer, and equal version vectors do not force envelope repair. A separate audit-envelope convergence experiment must explicitly transfer and verify those envelopes; ordinary matching-state reconciliation is not sufficient evidence.

Editing a value back does not reset CRDT history, version vectors, signatures, or storage. Independent repetitions need a fresh source and receiver or restoration of the same closed, immutable baseline. The cached original source has received both edits; its temporary signing secret was removed, so it is not a ready-to-edit pristine source. Native-generated IDs, peer IDs and signatures can vary on a fresh setup; record them and do not promise byte-identical packets merely because application values match.

Exact references: [harness lines 477–520](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/atomic/2026-10-26/outputs/harness/src/main.rs#L477), [live sender lines 293–305](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/atomic/2026-10-26/outputs/harness/src/main.rs#L293), [native live persistence lines 223–254](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/sync/ws_apply.rs#L223), [reconcile lines 1463–1478 and 1516–1535](https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/sync/engine.rs#L1463).

## 6. Proposed common rerun contract — not yet adopted or executed

Sync plus persistence is a more useful comparison only when the endpoints and retained responsibilities are stated explicitly. Use separate columns for application readability, native commit/flush acknowledgment, normal reopen, abrupt-process restart, and OS durability evidence. Do not equate browser completion, SQLite NORMAL commits, clean reopen, or an unobserved native durability claim with a measured fsync/power-loss guarantee.

The smallest useful Atomic supplement is an externally observed initial-readability run plus standardized incremental repetitions. Preserve the existing initial result; do not rerun merely to rename its endpoint. For a coordinated supplement:

1. Freeze the exact fixture hash above, Model H mapping, engine pins, and API/configuration choices for every worker. Record engine-specific history, authentication, indexing, and storage scope beside common application requirements.
2. Use a prepared, authenticated connection and open receiver before initial timing. Start immediately before the application sync request. State explicitly which sender preparation is cached. If another topology/preparation contract is selected centrally, label it as a new variant for all engines.
3. Define common readiness as all 132 fixture records reconstructing exactly with agreed table-query membership. Record search-index readiness separately unless equivalent search work is required for every engine. Atomic may add a public event-driven observer; timestamp predicate completion, not just event receipt. Preserve a separate native LAST-import-return timestamp and mark exact pre-flush time unavailable when it cannot be established.
4. Keep each engine's default durability/configuration as the primary baseline. Label any forced durability configuration separately. For Atomic, retain the explicit source-inferred flush caveat until independently resolved. Do not remove LAST, disable default flushing, or bypass envelope/index work.
5. Freeze one identical edit manifest across engines before execution. A concrete candidate is the two exact operations in section 5, in that order, on fixture IDs `issue-000` and `note-000`; this is a proposal, not an assertion of coordinator agreement. Any later one-digit edit must have an exact full before/after value and position in the manifest. Record raw UTF-8 value bytes, canonical JSON bytes, API operation type, and resulting hashes separately.
6. Before each independent repetition, restore a closed immutable baseline or recreate pristine source and receiver state outside timing. Wait for initial state convergence before editing. Start incremental timing immediately before the source mutation; report source API return, receiver value/index readability, and native persistence acknowledgment separately. Verify complete expected content after each operation outside the timed endpoint.
7. Count application-protocol bytes by direction and phase, including control messages when the shared contract requires them. Keep document/update bytes separate from protocol totals. Count compression consistently; do not mix uncompressed logical bytes with compressed wire bytes. Report OS/network framing separately if measured.
8. Report paired initialized baseline, post-sync total, and net storage, both allocated and apparent bytes, with sender/service storage separate. Record compression, index/history scope, and compaction policy. Keep clean-reopen verification separate from crash tests and OS sync evidence.
9. After the laptop is quiet and the coordinator resumes measurements, use three warmups and ten measured repetitions for comparability with the original series, unless the shared contract explicitly chooses another count. Preserve every sample and report nearest-rank p95 (the maximum at n=10). Run one engine's heavy work at a time under the shared lock. Record CPU/memory pressure before and after; do not silently discard samples.

No new comparative timings are appropriate under the reported contention. The coordinating chat reported **39% aggregate CPU busy, 15 GB of 16 GB RAM used, 6.9 GB compressed, at 10:34 Europe/Amsterdam on 2026-10-27**, with the shared lock free. These are coordinator-supplied observations, not measurements made by this audit. A free lock alone does not establish an idle machine.

## 7. Available local artifacts and future execution boundary

- Workspace: `$HOME/Documents/Codex/2026-10-26/sync-benchmark-atomic`.
- Runtime: `/private/tmp/atomic-sync-model-h-yjgxp2e7`.
- Existing binary: `/private/tmp/atomic-sync-model-h-yjgxp2e7/target/release/atomic-sync-benchmark` (present, 21,182,000 bytes at audit).
- Cached source, Cargo registry, build output, and `run-20261026T063214Z` stores remain present under that runtime. Presence does not itself prove a future rebuild will be unnecessary.
- Shared atomic-directory lock: `$HOME/Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock`.
- Lock wrapper: [with_measurement_lock.py](with_measurement_lock.py).
- This audit was initially saved locally and subsequently published at the user's request. Publication adds no new measurements; a shared final contract and resumed measurement window remain prerequisites for supplemental runs.
