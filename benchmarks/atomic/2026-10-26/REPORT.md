# Atomic Model H benchmark results

Measured on **2026-10-26 UTC** for [issue 41](https://github.com/ledgerloops/ledgerloops/issues/41), using Atomic commit `396f0da075bd514e2c46b2fa33a575b35c14b2a6` and the exact 415,448-byte synthetic fixture. Three warmups and ten measured transfers completed into fresh persistent receivers. All 13 receivers passed complete fixture reconstruction and native resource, CRDT, envelope, table and search-index verification after reopening.

## Initial replication

| Measurement | Median | p95 / maximum | Minimum |
| --- | ---: | ---: | ---: |
| SYNC request to native durable completion | 379.897 ms | 430.937 ms | 361.997 ms |
| Complete readable confirmation after durable return | 413.217 ms | 466.350 ms | 394.926 ms |
| Connection and authentication, excluded | 0.726 ms | 0.916 ms | 0.663 ms |

Percentiles use ten measured observations; nearest-rank p95 equals the sample maximum. None of the ten transfers met the 100 ms durable target. An earlier readable instant is unobservable through the native bulk-import API and remains null in the raw results. The confirmation above includes reconstructing the complete fixture after durable completion.

Each transfer received **2,867,466 application protocol bytes**, across three `SYNC_PUSH` chunks containing 159 resource entries and 159 retained signed envelopes:

| Component | Bytes |
| --- | ---: |
| Loro snapshots, including CRDT history | 1,158,957 |
| Signed envelope JSON | 1,661,318 |
| Protocol metadata | 47,191 |

The split is derived from measured totals, unchanged stored envelope lengths, observed chunk counts and the pinned fixed-width encoder. Setup traffic, requests, WebSocket framing and TCP/IP overhead are excluded. No WebSocket compression was negotiated; native Loro encoding/compression is included. Total application bytes are 6.90 times the canonical fixture size.

## Receiver and service storage

Bytes after documented flush, close and reopen, without compaction. Allocated values are medians across the ten measured receivers; raw results retain each paired baseline, total and net.

| Receiver measure | Initialized empty | Total after sync | Net growth |
| --- | ---: | ---: | ---: |
| Apparent file bytes | 2,109,440 | 16,846,848 | 14,737,408 |
| Allocated bytes | 2,060,288 | 10,285,056 | 8,224,768 |

Allocated totals ranged from 9,850,880 to 10,342,400 bytes. Sender/service storage was separately **16,846,848 apparent / 9,048,064 allocated bytes**. Only data storage is counted; executables, dependencies and build trees are excluded.

The receiver begins with 415 resource rows, including built-ins and the public temporary owner, and ends with 574. Net storage includes 159 materialized resources, 159 Loro snapshots, 159 retained envelopes, reference indexes, 132 table-query memberships and full-text indexes. The sender has 733 resource rows, including 159 signed commit materializations; its envelope tree references those resources. The receiver stores envelope JSON directly. [KV-tree counts and byte totals](outputs/model-h-20261026T063214Z/receiver-initial-logical-storage.json) distinguish these materializations from payload rows.

## Incremental changes

One observation per field on the already subscribed final receiver. Times include source set/sign/save and receiver merge/indexing. Full fixture verification occurs after timing; the final changed fixture also passed reopening.

| Change | Application bytes | CRDT update bytes | Readable | Durable |
| --- | ---: | ---: | ---: | ---: |
| Issue title | 293 | 194 | 6.203 ms | 25.651 ms |
| Note body | 2,877 | 2,778 | 5.294 ms | 21.409 ms |

These native live `UPDATE` deltas did not retransmit the complete resource. This tests scalar replacement, not an in-place deep JSON edit. Live UPDATE fanout does not carry a newly signed audit envelope: incremental durable timing covers state/index persistence, not convergence of that new audit envelope. Initial replication verifies all retained signed envelopes.

## Representation, fidelity and boundaries

Model H has **132 payload resources**: 21 issues and 111 notes, with all 30 comments embedded. There are 20 custom properties, two shared classes and five containers: a drive, two account folders and two tables. Title uses built-in Name. There is no duplicate complete-record JSON property. Nested objects and arrays, including 273 checklist items, are native JSON recursively represented in Loro containers.

Scalar columns retain IDs, numbers, flags, markdown bodies, URLs and timestamps. UTC timestamps become native milliseconds and reconstruct their exact fixture spelling. Null `closed_at` is represented by an absent optional typed property and restored to JSON null; other nulls remain native JSON null. Complete comparison checks every source field, array order and JSON type. Numeric fidelity is established for this fixture's values, without a broader large-integer claim. No attachment URL was fetched.

The prepared sender caches the native engine's authorized binary response before timing. Each receiver is open, persistent and authenticated before requesting SYNC. Empty native table queries are registered before timing so import maintains their indexes. Native `import_sync_push` runs with `trust_owned=false`; its LAST chunk returns after `Db::flush`, a nonempty redb Immediate transaction persisting preceding `Durability::None` writes. Default periodic flushing remains enabled. This is an OS/filesystem durability boundary, not a power-loss test. Live updates use checked owner write rights and native `ws_apply`, followed by an explicit receiver flush.

## Environment and scope

Apple M1 Pro, ten logical CPUs, 16 GiB RAM, macOS 26.6.2 / Darwin 25.6.0 arm64, APFS, Rust 1.99.1, redb 4.1.0 and Loro 1.12.0. Sender and receiver are native Db instances in one process, communicating over real loopback TCP/WebSockets on an ephemeral port. Stores, runtime code and isolated Cargo caches were under `/private/tmp`, outside the Documents provider. All 180 copied library files were verified against the pinned commit. No existing server, database, drive or signing key was used; the temporary test secret was removed.

Heavy work used the shared atomic-directory lock. Documents/Git-index reads timed out before measurement, prompting the runtime relocation. Free disk declined from about 14 GiB at setup to 8.3 GiB after builds/runs. Background laptop activity, thermal state and caches remain uncontrolled; these observations do not establish a cross-engine ranking.

Models R, C, O and G were deferred by the subsequent Model H-only instruction, not marked unsupported. Earlier initial readability and incremental new-audit-envelope convergence are the explicit unmeasured boundaries.

## Evidence and reproduction

- [Commands and publication layout](README.md)
- [Detailed original report](outputs/report.txt)
- [Machine-readable summary](outputs/summary.json)
- [All initial transfers](outputs/model-h-20261026T063214Z/results.json)
- [Incremental results](outputs/model-h-20261026T063214Z/incremental.json)
- [Raw measurement log](outputs/model-h-20261026T063214Z/raw.jsonl)
- [Exact fixture manifest](outputs/fixture/manifest.json)
- [External adapter source](outputs/harness/src/main.rs) and [dependency lockfile](outputs/harness/Cargo.lock)
- [Pinned source verification](outputs/source-provenance.json)
- [Publication notes](PUBLICATION.md)
