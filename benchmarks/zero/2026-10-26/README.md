# Rocicorp Zero synthetic sync benchmark

This local benchmark implements [ledgerloops issue 44](https://github.com/ledgerloops/ledgerloops/issues/44). It preserves the exact synthetic fixture and compares three PostgreSQL models through the official Zero replication stack. Strict durable timing is unavailable for this browser adapter: Zero uses relaxed IndexedDB transactions. Results distinguish complete query hydration, an observed native persistence transaction and offline reopening.

## Run locally

Prerequisites are Node 24.22.1, Python 3 and PostgreSQL 17.11. All PostgreSQL clusters, receiver profiles and browser binaries are task specific under `../../work`; ports 19440 and 19442–19446 must be free. Nothing uses an existing database or browser profile. Test users, the JWT signing secret, database password and admin password are synthetic, public benchmark constants.

```sh
./run-all.sh
```

On another machine, set `NODE24_BIN` to its Node 24.22.1 binary directory and update the shared coordination directory in `with_lock.py`. The lock wrapper waits at most 900 seconds per invocation and yields while any Atomic wait or priority marker exists. It removes only its own lock. Browser downloads are pinned by Playwright 1.64.1 and kept under the task's work directory. Dependencies are pinned by `package-lock.json`.

For an individual supported model after installation and bundling:

```sh
export PATH="$NODE24_BIN:$PATH"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/../../work/browsers"
python3 with_lock.py env VARIANTS=typed node run.mjs
# Other variants: record, collection. Defaults: 3 warmups and 10 measured runs.
```

Fresh run directories are selected automatically. Set `BENCHMARK_DATA_ROOT` to an isolated alternate directory if Documents file-provider behavior interferes; each raw environment record includes the actual storage path. Run `./finalize.sh` to regenerate the report and audit the required exported evidence. Raw result JSON is written under `results/`; startup and temporary diagnostic logs stay under `../../work/`. Failed smoke tests are excluded from measurement summaries. A failure leaves its exact error and completed measurements in the JSON; it is never replaced by published performance.

## Models

| Variant | PostgreSQL representation | Entity and update granularity |
| --- | --- | --- |
| typed | 21 issue rows and 111 note rows; every scalar is typed; each nested object or array is JSONB | Original source ID is the primary key. Dates remain exact strings. Nulls remain nulls. The API can address individual scalar columns; nested values occupy whole JSON columns. |
| record | Same 132 primary keys; one JSONB column holds each complete source record | Embedded IDs and all fields are preserved. A field edit changes the JSONB value of one record. |
| collection | Two primary keys, `issues` and `notes`; each JSONB value holds the complete ordered collection | Source records and their IDs remain inside the arrays. One field edit replaces that collection's JSONB value. |

The named queries have no limits or pagination and subscribe to every row in the chosen model. Zero normally syncs only rows selected by active or cached queries; an application's first screen is not a full dataset benchmark. These three variants retain every source field. None normalizes nested source entities into additional tables.

The query endpoint verifies a locally signed JWT and returns the authenticated synthetic user ID through Zero's standard query handler. Only the registered full-dataset queries are exposed. Legacy arbitrary queries and CRUD mutations are disabled. A normal mutation endpoint with an empty mutation registry is present; the sender's incremental updates use PostgreSQL transactions, so the receiver cannot report optimistic local writes as convergence. Integrity and PostgreSQL durability settings remain at their defaults. The adapter uses one sync worker. Internal change-streamer traffic is explicitly routed through loopback; the service replica uses Zero's native WAL2 and NORMAL synchronous settings.

## Measurement boundaries

The sender fixture is imported before any client timer. Zero-cache must become ready and its SQLite replica is reconstructed and checked against the fixture. Browser process launch and receiver script startup are recorded separately from `connection_ms`, which includes local Zero store initialization and transport/authentication. Each receiver starts in a fresh browser profile, opens its native IndexedDB database and connects without subscribing to payload queries. It closes once to measure the initialized-empty storage baseline, then reopens and reconnects before timing.

The initial timer starts immediately before materializing all named queries. `readable_ms` ends after every query reports `complete`. Browser API instrumentation observes native IndexedDB puts and transaction completion without changing any options or values. `persistence_transaction_ms` ends when completed transactions for this Zero database contain all 132 source IDs. Incremental tests instead match the unique changed-field marker. Full fixture equality and its SHA-256 are checked outside the timer, then the browser closes and reopens with no cache URL and blocked cache access. Local-only Zero queries must recover the complete fixture.

This persistence observation is weaker than a public SDK acknowledgement of a specific fully persisted snapshot. IDB transaction completion does not establish an fsync boundary: the pinned engine explicitly uses `{durability: "relaxed"}`. Therefore `durable_ms` is null, and the persistence observations must not be ranked alongside engines with strict durable acknowledgements. Successful reopening establishes readable persistent state after a normal close; it does not establish survival of power loss. No private flush API, forced compaction or engine modification is used. Native automatic LevelDB maintenance remains enabled. Browser storage eviction and Zero cache expiry retain their defaults.

Each model runs 3 warmups and 10 measured transfers into distinct persistent receivers. Every measured receiver is fully verified after reopening. Percentiles use the 10 measured samples: p50 is the mean of the middle two sorted observations, p95 uses nearest rank and therefore equals the maximum for n=10. The incremental receiver remains subscribed while an issue title, then a note body, receives a deterministic suffix. Each update is verified and the final changed fixture is checked after offline reopening.

Browser message instrumentation counts UTF-8 WebSocket application payload bytes after decompression. A dedicated TCP proxy separately counts bytes in each direction, including WebSocket frame headers and any negotiated compression. Connection handshakes are captured separately and excluded from transfer snapshots. These counts exclude IP/TCP packet overhead, retransmission, other local traffic and PostgreSQL/cache/API traffic. The update convergence timer also includes the local harness dispatch and sender transaction commit; `sender_commit_ms` records the latter separately.

Receiver storage includes only the fresh profile's IndexedDB, WebStorage quota metadata, Local Storage profile identity and Session Storage reload metadata directories, measured after Zero and the browser close. It includes native LevelDB tables, logs, manifests, browser quota/bucket metadata and engine database metadata; it excludes the remainder of the browser profile. Both apparent bytes and allocated bytes (`st_blocks * 512`) are recorded for baseline, total and net growth. Required PostgreSQL cluster storage, per-database page sizes and Zero SQLite replica/WAL files are reported separately. PostgreSQL is checkpointed and shut down normally for final physical storage accounting. Service totals cover the complete experiment for that model, including warmups, 10 receivers and incremental tests; per-database sizes separate upstream, CVR and change storage.

## Primary references

The implementation follows the [Zero query API](https://zero.rocicorp.dev/docs/queries), [schema types](https://zero.rocicorp.dev/docs/schema), [PostgreSQL compatibility](https://zero.rocicorp.dev/docs/postgres-support) and [self-host topology](https://zero.rocicorp.dev/docs/self-host). Version-specific evidence is the pinned npm package source: `out/replicache/src/kv/idb-store.js` uses relaxed IDB transactions, `out/replicache/src/persist/persist.js` commits the persistent graph and client metadata, and `out/replicache/src/replicache-impl.js` schedules persistence separately from view updates. The client connection source is read through `zero.connection.state.current` in 1.11.3.
