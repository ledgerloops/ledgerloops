# Any-sync benchmark: methodology and persistence audit

Audit date: 2026-10-27. This is a source and artifact audit, with no new benchmark execution, build, import, or timing sample. Original measurements and artifacts are unchanged. The original publication is in `benchmarks/anytype/2026-10-26`; its checksum manifest describes that original publication, not this later addendum.

The comparison snapshot is ledgerloops/ledgerloops commit `104eb59e4ef50b4375413dc4192083c5f0c4b0b3`. Engine pin: any-sync `9c00aeeb97370712af8e99bde4a81c586651e903`; any-store v1.0.3; go-sqlite v1.4.2-any; modernc.org/sqlite v1.37.1 (SQLite 3.49.2); Go 1.26.10, darwin/arm64. Dependency versions and checksums remain in the published go.mod/go.sum. The full Anytype application was not measured.

## Findings for the comparison

1. Persistence is already part of this native Any-sync adapter. Remote changes are committed through any-store before native apply returns. Pinned source implies SQLite WAL with synchronous=FULL by default. Live writer PRAGMAs and OS synchronization calls were not recorded, so this is a source-inferred configuration, not runtime-observed proof.
2. The reported `fsync` timing is an SDK flush acknowledgement after full fixture visibility and queued message completion. In FULL mode the SDK's flush method returns without issuing a new fsync. The small gap between visibility and flush cannot be interpreted as the cost of synchronizing the dataset to disk.
3. Edit traces are materially different across adapters. Any-sync replaces a 2,528-byte body with 27 bytes; other adapters generally append text. Even an identical logical append would still transmit full replacement records or collections through the existing Any-sync models.
4. Topology, native transaction counts, sender preparation, verification placement, history, indexing, and runtime differ. These are results for specific adapters and representations, not an intrinsic ranking of full applications or equivalent CRDT text edits.
5. Current laptop pressure and different historical runtime/browser environments prevent credible rankings from small timing differences. Current pressure does not establish how busy the machine was during the original samples. No supplemental timing run was performed.

## Persistence boundaries and guarantees

The [published harness](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/anytype/2026-10-26/outputs/harness/main.go#L589) starts initial-transfer timing immediately before serial native tree fetches. It reconstructs, decrypts/parses as needed, encodes, and byte-compares the full fixture before recording visibility (lines 589–600). It then waits for queued broadcasts and awaits `Flush(ctx, 0, FlushModeFsync)` before the second timestamp (601–604). Neither timestamp is an instrumented SQL commit instant.

Incremental timing starts before sender AddContent (644–654). It includes sender signing, encryption, native storage commit, delivery, receiver apply, and complete fixture comparison. Some comparison adapters prepare their payloads outside their timed transfer stages. Receiver close/reopen checks happen later. `closeDB` performs another flush and normal close outside the timer; reopening therefore cannot independently certify the earlier timed boundary. Reopens occur in the same process with retained keys. There is no independent process restart, abrupt termination, power-loss, or syscall trace result.

Pinned source evidence:

| Component | Source location | What it establishes |
|---|---|---|
| any-sync | `commonspace/object/tree/objecttree/storage.go:276–307` | Raw changes and heads are committed through a write transaction; commit errors propagate. |
| any-sync | `commonspace/object/tree/objecttree/objecttree.go:399–450` | AddRawChanges calls storage before successfully returning. |
| any-sync | `commonspace/object/tree/objecttree/storagedeferred.go:154–177` | Initial root creation and changes share an outer transaction. |
| any-store v1.0.3 | `config.go:10–12,74–99`; `internal/driver/manager.go:84–89,250–280` | Nil configuration applies defaults, opens WAL, and supplies cache_size rather than overriding synchronous. AutoFlush is false by default; optional passive auto-checkpoint settings do not enable it. |
| go-sqlite v1.4.2-any | `sqlite.go:132–147` | OpenWAL requests journal_mode=wal without a synchronous downgrade. |
| modernc SQLite v1.37.1 | `lib/sqlite_darwin_arm64.go:2632–2634` | Compiled default synchronous and WAL synchronous values are 2 (FULL); default auto-checkpoint is 1,000 pages. |
| any-store v1.0.3 | `internal/driver/conn.go:181–228` | Fsync queries synchronous, then immediately succeeds for FULL/EXTRA. |
| any-store v1.0.3 | `internal/durability/flush.go:29–47`; `controller.go:229–266` | Requested flush acquires the writer and delegates to that function. Checkpoint is a different mode. |

Paths for any-sync are relative to its pinned repository. Module paths refer to exact versions in the published dependency graph. [SQLite documents FULL WAL commit synchronization](https://www.sqlite.org/pragma.html#pragma_synchronous). This differs from macOS `F_FULLFSYNC`: [fullfsync](https://www.sqlite.org/pragma.html#pragma_fullfsync) defaults off and requests a stronger platform operation. The pinned SQLite source distinguishes ordinary fsync from F_FULLFSYNC (`sqlite_darwin_arm64.go:30414–30447,42654–42670`) and allows fallback to ordinary fsync. The public SDK does not acknowledge which syscall actually occurred or guarantee physical controller/media behavior.

There is also a source-derived concern for *weaker configured modes*: any-store's fallback temporarily requests FULL and commits an empty transaction. SQLite's commit path can return early without changes (`sqlite_darwin_arm64.go:45215–45234`). This deserves a focused test before treating that fallback as a generic barrier for previously unsynchronized WAL writes. It is an unverified hypothesis, not observed data loss, and does not establish a problem with the source-default FULL baseline measured here.

Native initial visibility/SDK-flush medians were 133.728/133.751 ms for record_trees, 21.779/21.798 ms for collection_blocks, and 12.417/12.443 ms for opaque_collections. The median paired flush-minus-visibility gaps were approximately 0.020, 0.019, and 0.021 ms. These gaps include waiting and SDK checking. Ten measured samples per model make nearest-rank p95 the sample maximum; they provide little tail resolution.

## Representation, defaults, and topology

The three models contain 132 record trees, two collection trees with record operations, or two opaque collection trees. A JSON operation replaces a complete record or collection array. There is no field-level text CRDT operation, Anytype application schema, application search index, or Tantivy indexing. Every trial starts with fresh sender/receiver stores and fresh tree history; a title replacement then a body replacement follow the initial transfer. No snapshot/compaction optimization is requested.

Native trees sign and encrypt changes and validate incoming content/ACL identity. LocalOnly omits consensus acceptor verification; it does not omit all authentication. The adapter requests peer client authentication. Native RPC Snappy compression is false by its zero-value configuration. The 1 MiB native response batching threshold exceeds each tree in this fixture. Pinned source suggests roughly 132 initial per-tree storage transactions versus two for collection models; transactions and sync calls were not counted during the run.

Both peers run inside one Go process, share the Go runtime and OS page cache, and use separate native SQLite databases and device keys under one generated account signing identity. GOMAXPROCS=4 on a 10-logical-core Apple M1 Pro with 16 GiB RAM. Connections, synthetic ACL/header/settings metadata, and tree identifiers are prepared before transfer timing. Routing/topology is static; the full discovery, scheduler, coordinator/consensus/file-node stack is absent. Service storage zero describes this direct-peer topology only. Reported native transport bytes include session framing but exclude lower network framing.

Full reconstruction reuses cached decoded operations where available (`objecttree.go:695–719`). In particular, old operations loaded before incremental timing need not all be decrypted again. Store sizes are measured after flush/close, so they may reflect checkpointing and are not live WAL occupancy at the timed endpoint. Retained replacement history explains why opaque storage can grow even while a replacement body shrinks.

## Cross-adapter edit trace differences

The starting fixture is 415,448 compact JSON bytes, SHA256 `9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a`. Initial first title/body lengths are 54/2,528 raw UTF-8 bytes. JSON string lengths include quotes and escaping and must be reported separately.

| Adapter | Exact source transformation | History detail |
|---|---|---|
| Any-sync | Title becomes `Synthetic issue title updated`; body becomes `Synthetic note body updated` (29/27 raw bytes). | One pair per fresh trial; full record/collection replacement operations. |
| Atomic | Title becomes `Synthetic changed issue title`; body appends ` Synthetic incremental edit.` | Full-fixture validation is after its timed boundary. |
| Zero | Append a space plus `SYNTHETIC-TITLE-UPDATE-44` / `SYNTHETIC-BODY-UPDATE-44`. | Separate incremental receiver path. |
| Jazz | Set each field to fixture base plus ` [benchmark-title-${rep}]` / ` [benchmark-body-${rep}]`. | First operation appends; later operations replace the suffix counter, rather than cumulatively append. |
| PowerSync | Set each field to fixture base plus ` [synthetic update]`. | Fields are reset between pairs on a subscribed receiver; reverse writes do not reset history. |
| Replicache | Append ` [synthetic title update]` / ` [synthetic note body update]`. | Changed views and encoded snapshots/patches are prepared before timed stages. |

Evidence at the comparison snapshot: [Atomic:484–512](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/atomic/2026-10-26/outputs/harness/src/main.rs#L484), [Zero:573–607](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/zero/2026-10-26/run.mjs#L573), [Jazz:77–103](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/jazz/2026-10-26/run.mjs#L77), [PowerSync:95–106](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/powersync/2026-10-27/run.mjs#L95), [Replicache model:59–63](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/replicache/2026-10-26/model.js#L59) and [runner:122–127](https://github.com/ledgerloops/ledgerloops/blob/104eb59e4ef50b4375413dc4192083c5f0c4b0b3/benchmarks/replicache/2026-10-26/runner.mjs#L122). These checks establish trace differences, not a complete durability audit of those other engines.

## Laptop contention and interpretation

The coordinating chat supplied a 2026-10-27 10:34 Europe/Amsterdam observation: 39% aggregate CPU busy across 10 cores, 15 GB of 16 GB RAM used, 6.9 GB compressed, and no shared measurement lock present. This audit did not independently sample those counters. A missing cooperative lock does not establish an idle laptop. Those conditions can perturb new wall-clock timings and make shared runtime/cache/memory pressure important.

The observation is later than the original Any-sync measurements and cannot quantify their historical interference. Different historical runtimes and browser environments add further confounders. Do not rank small timing differences or claim statistical significance from these heterogeneous trials. Even large gaps remain conditional on representation, topology, and timed work. Retain byte/storage observations with their exact definitions and label timing comparisons exploratory.

## Smallest useful supplement, proposed only

Agree on one shared trace manifest first: fixture hash, exact target IDs, ordered UTF-8 old/new values or cumulative append suffixes, per-step hashes/lengths, sample count, history reset policy, and endpoint definitions. Preserve the three existing Any-sync models. Use fresh sender spaces/trees and receivers per replicate so history matches; reverse writes are not an equivalent reset. Match sender work and verification placement across adapters, or expose their time separately.

For this adapter, add timestamps for native fetch/apply return, full verified visibility, and SDK flush return, clearly identifying each endpoint. A native apply-return timestamp is not an exact SQL commit timestamp. Keep normal reopen verification separate. If independent process restart validation is required, save only newly generated synthetic keys locally outside timing and restart with supported accountdata/crypto APIs; never publish keys. The old runs retained keys only in memory and cannot supply this validation retroactively.

Use the existing cooperative measurement lock, an idle laptop, and recorded pressure/runtime versions for a future agreed run. No new timing is useful under the supplied current pressure. One shared title/body pair per fresh replicate is the smallest trace correction; a cumulative append series is needed if growth/history behavior is the question. Full record/collection payload amplification remains a modeling result. A patch-operation model would be a separately labeled experiment.

The native build, pinned checkout, module cache, compiler, and measured store directories were found under `/private/tmp/sync-benchmark-anytype-20261026-01a176de-build` and the original measured-run directory. They were inspected without execution. Build reuse is possible; old encrypted stores lack persisted private identities for independent reopening. Existing live writer PRAGMAs and actual fsync/F_FULLFSYNC calls are not exposed as public any-store DB acknowledgements. A stronger `synchronous=FULL, fullfsync=ON` request can use SQLiteConnectionOptions, but must be a separately labeled variant with the platform fallback limitation retained. A full Anytype app/service benchmark requires additional infrastructure and application modeling.
