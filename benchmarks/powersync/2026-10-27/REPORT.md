# PowerSync synthetic sync benchmark

Measured on **2026-10-27**, run `2026-10-27T08-43-34-519Z`, for [ledgerloops issue #42](https://github.com/ledgerloops/ledgerloops/issues/42). All three requested models passed **3 warmups and 10 measured initial transfers each**, plus **10 issue-title and 10 note-body updates per model**. Every initial transfer reconstructed the complete fixture after receiver close/reopen. Each incremental pair also passed full close/reopen verification. The independent audit confirms 39 initial transfers, 60 incremental updates, and zero failures.

**Two contract limits remain unmeasured:** strict power-loss durable completion, and transfer time with an already-established transport throughout the subscription change. The SDK uses SQLite WAL with `synchronous=NORMAL` and restarts its WebSocket when a new subscription is added. The times below are explicitly subscription + SDK reconnect + full checkpoint application, not equivalent to an fsync acknowledgement or a transfer over a permanently established connection.

## Initial transfers

Milliseconds; p50 is the sample median. Nearest-rank p95 over **n=10** equals the sample maximum. Warmups are excluded. Observable time includes reading and hashing all reconstructed content; its polling and hashing overhead can place it after checkpoint application.

| Model | Observable p50 | p95 / max | Checkpoint applied p50 | p95 / max | Decoded application bytes | Compressed WS payload bytes | Socket received bytes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| typed | 25.89 | 83.09 | 21.18 | 77.76 | 448,263 | 121,137 | 121,671 |
| record_json | 21.13 | 30.58 | 17.80 | 22.40 | 456,083 | 121,511 | 122,045 |
| collection_json | 18.21 | 23.99 | 14.19 | 17.09 | 427,232 | 106,847 | 107,381 |

Received initial byte counts were identical across all ten measured repetitions of each model. The prepared sender fixture was unchanged throughout the 13 initial transfers; incremental tests ran afterward so their history did not inflate initial-transfer costs.

The socket count includes HTTP/WebSocket framing and control responses, but excludes IP/TCP headers, retransmissions and TLS (loopback is unencrypted). WebSocket payload counts reflect negotiated `permessage-deflate` compression with server context takeover. Application bytes count decoded RSocket PAYLOAD data, excluding RSocket framing/metadata, WebSocket control frames and HTTP checkpoint-response bodies. Captured frames are decompressed **after timing**, with context preserved. Raw JSON also contains expanded RSocket message totals and frame/connection counts.

## Untimed preparation

| Model | Receiver initialization p50 ms | Connection/auth + empty checkpoint p50 ms | Sender/service preparation ms |
| --- | ---: | ---: | ---: |
| typed | 216.50 | 18.12 | 4192.89 |
| record_json | 204.83 | 17.71 | 3502.41 |
| collection_json | 205.48 | 17.23 | 3498.32 |

The sender is a fresh PostgreSQL source, an official self-hosted PowerSync service, and a separate PostgreSQL bucket database. A separate SDK readiness receiver checks the full fixture and requests a source-position checkpoint before timing; it disconnects during each transfer. Fresh receiver schema creation, startup and initial authentication complete before the main timer. Subscription changes nevertheless trigger **one new WebSocket per timed transfer** through the supported SDK API. No reconnect cost was silently subtracted; `strictEstablishedTransportOnlyMs` is null for every transfer.

## Receiver storage

Median bytes across ten measured receivers, shown as **apparent / allocated**. Initialized-empty and post-sync samples follow SDK close. Every file in the dedicated receiver directory is counted, including SQLite, WAL and SHM. The WAL remains after SDK close and contains most of the stored payload; measuring only the `.sqlite` file would be incorrect. No manual checkpoint, VACUUM or compaction was applied to receiver storage.

| Model | Initialized empty | Post-sync total | Net growth |
| --- | ---: | ---: | ---: |
| typed | 156,376 / 159,744 | 1,429,456 / 1,429,504 | 1,273,080 / 1,269,760 |
| record_json | 148,136 / 151,552 | 1,423,276 / 1,423,360 | 1,275,140 / 1,271,808 |
| collection_json | 139,896 / 143,360 | 1,116,336 / 1,118,208 | 976,440 / 974,848 |

These are independent medians; raw JSON records exact per-receiver totals, net growth and file inventories. All initialized and populated receivers were reopened and their full canonical fixture SHA-256 checked outside timing.

## Required source/service storage

Physical bytes for each isolated PostgreSQL cluster, again **apparent / allocated**. Baseline includes two empty databases; prepared includes imported source content, active bucket state and indexes. Samples follow PostgreSQL `CHECKPOINT` while the service remains live. Final is after the incremental tests. Shared catalogs and WAL are included. Executables, npm dependencies, code, runtime logs and the SDK readiness receiver are excluded.

| Model | Empty cluster baseline | Prepared cluster total | Prepared net growth | Final cluster total |
| --- | ---: | ---: | ---: | ---: |
| typed | 55,807,054 / 55,881,728 | 74,135,278 / 74,412,032 | 18,328,224 / 18,530,304 | 74,569,598 / 74,997,760 |
| record_json | 55,807,066 / 55,881,728 | 74,118,906 / 74,395,648 | 18,311,840 / 18,513,920 | 74,512,266 / 74,891,264 |
| collection_json | 55,807,074 / 55,881,728 | 73,832,194 / 74,108,928 | 18,025,120 / 18,227,200 | 78,141,330 / 80,355,328 |

Logical source-versus-bucket database sizes are separately measured by `pg_database_size`; these are **not** physical allocated-block counts and must not be added to the cluster totals.

| Model | Empty source / bucket DB | Prepared source / bucket DB | Final source / bucket DB |
| --- | ---: | ---: | ---: |
| typed | 7,643,663 / 7,643,663 | 8,165,043 / 8,672,947 | 8,206,003 / 9,066,163 |
| record_json | 7,643,663 / 7,643,663 | 8,140,467 / 8,681,139 | 8,140,467 / 9,074,355 |
| collection_json | 7,643,663 / 7,643,663 | 8,025,779 / 8,509,107 | 10,147,507 / 10,696,371 |

## Incremental changes

Ten serial observations per field and model, on the last persistent receiver after all initial transfers. A **19-byte UTF-8 suffix** is appended to `issue-000.title`, then `note-000.body`; resets and checkpoint verification occur outside subsequent timers. Source commit is included in convergence. Each pair is followed by close/reopen verification. Ordinary history can accumulate during these incremental tests.

| Model | Field | Observable p50 ms | p95 / max | Checkpoint p50 ms | p95 / max | Decoded application bytes p50 | Compressed WS bytes p50 | Socket bytes p50 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| typed | title | 18.79 | 41.75 | 22.38 | 151.30 | 4,606.50 | 1,526 | 1,824.50 |
| typed | body | 18.64 | 33.02 | 149.67 | 189.79 | 3,909 | 1,356 | 1,655 |
| record_json | title | 15.38 | 35.03 | 23.72 | 180.36 | 4,665 | 1,537 | 1,834 |
| record_json | body | 15.78 | 32.38 | 195.14 | 215.52 | 3,958 | 1,371.50 | 1,672 |
| collection_json | title | 24.18 | 28.80 | 25.43 | 97.55 | 87,160 | 23,580 | 23,879 |
| collection_json | body | 35.53 | 47.89 | 31.82 | 38.87 | 340,991 | 83,550 | 83,851 |

The full source-position barrier and its control traffic can finish later than the updated record becomes readable; that difference is not an fsync measurement. The collection model transfers much more data for a one-field change: the update unit is the entire issue or note collection, even though only 19 source bytes were added.

## Models and authorization

- **typed**: 21 issue rows and 111 note rows. Scalar text, integer and boolean columns; nested objects/arrays stored as JSON in PostgreSQL and text in SQLite. JSON nulls, array order, IDs and every source field are preserved.
- **record_json**: 132 rows with an ID and the complete record JSON. It simplifies round-tripping while making fields inside JSON less convenient for direct SQL queries.
- **collection_json**: two rows containing the complete issue and note arrays. It is supported and round-trips correctly. It makes a whole collection the replication/update and row-authorization unit; inner records cannot be independently authorized by this row model.

PowerSync row operations are not field-level JSON CRDT edits. The typed model still emits row updates. A Sync Config using edition 3 Sync Streams authorizes only the synthetic JWT subject and selects the model tables. Source PostgreSQL RLS is not implicitly applied to replicated data. The runner uses ordinary service JWT validation, checksum/checkpoint processing and native SDK replication; it does not insert fixture rows into the receiver or copy database files as replication. No application secondary indexes or engine-internal optimizations were added.

## Correctness, durability and environment

- Fixture: **415,448 bytes**, 21 issues + 111 notes. SHA-256 `9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a`. Complete source fields, nested content and collection array ordering are checked, not just record counts.
- Updated fixture hashes are in [expected-updates.json](expected-updates.json); `verify_results.py` independently audits the prescribed counts, full initial/reopen hashes, incremental hashes and storage/byte consistency.
- Persistence boundary: full `subscription.waitForFirstSync()` and, for updates, `requestCheckpoint().waitForSync()`. SDK control calls run in SQLite write transactions. Default observed settings are WAL, `synchronous=1` (NORMAL), `fullfsync=0`, `checkpoint_fullfsync=0`. `durableMs` remains null. Reopening verifies process-restart correctness, not sudden-power-loss durability.
- Hardware: Apple M1 Pro / MacBookPro18,1, 10 logical CPUs, 16 GiB RAM; native macOS 26.6.2 / Darwin 25.6.0, arm64, APFS. No container or browser; no cgroup or CPU quota.
- Pinned versions: PowerSync Open Edition service 1.27.2 (commit `12fa59d700ded33dc33770855bde90ffb60ebc8f`), Node SDK 1.2.0, SQLite core `0.5.3/2ba6b280`, SQLite 3.53.4, better-sqlite3 13.0.3, Node 24.22.1, PostgreSQL 17.11 (Homebrew). Exact npm dependencies and integrity hashes are in the lockfile.
- Code/dependency runtime: `/private/tmp/powersync-issue42-runtime-ef925v4a`. Measured stores: `/var/folders/wt/27c34cxn34vgbq8wj307ln0m0000gn/T/powersync-synthetic-benchmark/2026-10-27T08-43-34-519Z`. The full recorded paths and runtime version inventory are in the environment artifacts.
- Source PostgreSQL uses a new synthetic identity, SCRAM authentication, `wal_level=logical`, a publication and `REPLICA IDENTITY FULL`. `fsync`, `synchronous_commit` and `full_page_writes` remain enabled at defaults. Each model uses its own source/bucket databases and ephemeral ports. Service JWT keys are generated in memory, telemetry sharing is disabled, and no vendor cloud or personal data is involved.
- The service is the unmodified official npm distribution, run natively because Docker was unavailable. Its built-in listener binds `0.0.0.0` on a selected isolated port; all benchmark traffic uses loopback. The supported WebSocket/RSocket transport is selected explicitly; the SDK-preferred HTTP streaming transport was not measured.
- Service package license: FSL-1.1-ALv2; the service identifies itself as Open Edition. This topology needed no paid account, enterprise feature or license key. See the [pinned license](https://github.com/powersync-ja/powersync-service/blob/v1.27.2/LICENSE) and [self-hosting documentation](https://docs.powersync.com/intro/self-hosting).
- All sustained setup, installation and measurements ran under the shared atomic-directory lock. Atomic Model H priority was honored. Other workers could perform light source/network work; OS background work, power state and thermal state were not controlled. Cross-engine rankings remain provisional.

## Reproduction and artifacts

- [Run instructions](README.md) and [detailed methodology](README.txt).
- [Raw measurements](results/2026-10-27T08-43-34-519Z/raw.json), [summary](results/2026-10-27T08-43-34-519Z/summary.json), [environment](results/2026-10-27T08-43-34-519Z/environment.json), [environment supplement](results/2026-10-27T08-43-34-519Z/environment-supplement.json).
- The same result directory contains each model’s deployed Sync Config and source/service storage inventories.
- [Package lockfile](package-lock.json), [version pins](pins.json), [frozen issue contract](issue-42.md), [fixture manifest](fixture/manifest.json), adapter source and byte-counter checks are included.

The 2026-10-26 exploratory sequence passed correctness checks but mixed incremental mutations into successive initial transfers and lacked decoded compression counters. It is excluded from these primary summaries. An interrupted corrected run never acquired the lock. A 2026-10-27 attempt stalled during a Documents-backed dependency read before measurement; the completed run installs and executes entirely outside Documents. No published or vendor benchmark numbers were substituted.

Primary implementation references: [Node SDK](https://docs.powersync.com/client-sdks/reference/node), [Sync Stream client APIs](https://docs.powersync.com/sync/streams/client-usage), [self-hosted service configuration](https://docs.powersync.com/configuration/powersync-service/self-hosted-instances), [JSON mapping](https://docs.powersync.com/client-sdks/advanced/custom-types-arrays-and-json), and [pinned service source](https://github.com/powersync-ja/powersync-service/tree/v1.27.2).
