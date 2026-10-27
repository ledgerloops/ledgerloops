PowerSync synthetic benchmark for https://github.com/ledgerloops/ledgerloops/issues/42

Prerequisites: native macOS arm64 or another platform supported by @powersync/node;
Node.js 24.22.1; PostgreSQL 17.11 initdb, postgres, pg_ctl on PATH; Python 3.
No Docker daemon, vendor account, personal credentials or license key is used.
The official @powersync/service-image npm distribution runs unmodified natively.

Run from this benchmark's directory (the directory containing package.json):
  export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:/opt/homebrew/bin:$PATH"
  python3 generate_fixture.py fixture
  python3 with_measurement_lock.py python3 isolated_runtime.py
  python3 collect_results.py

isolated_runtime.py stages the sources and exact lockfile in a new /private/tmp
folder, installs pinned dependencies there, checks the wire decoder, then execs
the benchmark under the SAME shared lock. This avoids Documents file-provider
read stalls. collect_results.py copies aggregate result JSON back, audits all
39 transfers and 60 incremental updates, and generates summary.json.

On this laptop, the shared lock defaults to:
  $HOME/Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock
On another host, export BENCH_LOCK_PATH to the agreed shared directory path before
invoking the commands. The wrapper and runner use the same value. Never remove
another owner's lock or the originating chat's Atomic priority marker.

Default protocol: three warmups and ten measured fresh receivers PER model,
then ten issue-title/note-body incremental pairs using the last receiver. This
keeps sender history unchanged during all initial transfers. No automatic
compaction is requested.

For development smoke runs only, set BENCH_VARIANTS=typed BENCH_WARMUPS=0
BENCH_REPS=1 on the wrapper invocation. The full-result audit intentionally
requires the complete prescribed sample and will reject smoke runs.

Source modules:
  generate_fixture.py -- exact issue generator, unmodified
  models.mjs         -- typed/record JSON/collection JSON adapters and reverse maps
  run.mjs            -- local source, service, SDK, timers, reopen verification
  isolated_runtime.py -- stage/install/run outside Documents, retaining shared lock
  collect_results.py -- collect and audit aggregate result artifacts
  verify_results.py  -- counts, fixture hashes, wire/storage and update audit
  wire.mjs           -- transparent loopback TCP observer; websocket/RSocket parser
  storage.mjs        -- apparent and allocated receiver/service tree sizes
  summarize.py       -- measured-only n/p50/p95/max; nearest-rank p95
  verify-wire.mjs    -- counter validation with fragmented network chunks

All runtime data, logs and source PG clusters stay in the dedicated OS temporary
directory <os.tmpdir()>/powersync-synthetic-benchmark/<UTC>/<model>, outside Documents.
BENCH_WORKDIR can override this root. The exact path is recorded in environment.json.
Only synthetic fixture, code, pinned lockfile and result artifacts belong in outputs.
Results live in outputs/results/<UTC>. The latest completed run is in latest.txt.
Every run creates new directories and dynamically chooses unoccupied ports.
Only processes and clusters created by that run are stopped during cleanup.
The script refuses sustained work unless its direct parent owns the shared lock.

Receiver baseline is initialized, closed SQLite; receiver is reopened and the empty
authenticated checkpoint completes before the full-dataset subscription timer.
Sender readiness is confirmed with a separate SDK receiver and a requested source
checkpoint before each transfer. That readiness receiver disconnects during timing.
Initial completion uses subscription.waitForFirstSync(), with no priority limit.
If the SDK restarts its WebSocket on a subscription change, that reconnect is
included in checkpointAppliedMs and the window's websocketUpgrades records it.
In that case strictEstablishedTransportOnlyMs is null: the SDK workflow does not
provide the contract's strict transport-preestablished measurement, and the
subscription+reconnect result must be labeled separately. No reconnect duration is
silently subtracted and no SDK internals are modified to avoid it.
The observable boundary includes reading and hashing the entire reconstructed data.
A 2 ms polling delay and hashing overhead may put observed time after checkpoint time.
Incremental start precedes the source UPDATE, includes source commit, and awaits
requestCheckpoint().waitForSync(), then confirms the full modified fixture.
Incremental checks run after reconnecting the already-subscribed reopened receiver.
Each incremental pair is followed by full close/reopen verification. Before the
next pair, the source is reset and a full checkpoint verifies the original fixture
outside the timer; ordinary bucket history may accumulate during incremental tests.
Both original and changed content are verified after close and reopen.

Wire windows use counter differences immediately before subscription/source UPDATE
through full-checkpoint and full-content observation. Compressed WebSocket
messages are captured and decoded AFTER timing, using the negotiated context
takeover rules. Decoding preserves the exact measurement-window boundaries. Counts include engine control
traffic in that window. TCP socket received bytes include HTTP/WebSocket framing,
exclude IP/TCP headers/retransmissions, and include HTTP checkpoint responses.
websocketPayloadBytes counts compressed frame payload including RSocket framing.
decodedWebsocketPayloadBytes counts expanded RSocket messages, including control.
rsocketPayloadDataBytes counts decoded type-10 RSocket PAYLOAD data after protocol/metadata.
It excludes HTTP checkpoint-response bodies and WebSocket/RSocket control frames.
The SDK negotiates permessage-deflate with server context takeover; compression
is left at engine defaults. Receiver SQLite uses synchronous=NORMAL (1), WAL,
fullfsync=0 and checkpoint_fullfsync=0 in the recorded run.
No TLS is used on loopback. compressedFrames reports the websocket RSV1 bit; response
headers are retained. There is no tcpdump-based L2 count.

Durability: durableMs is null. SDK checkpoint application runs in a SQLite write
transaction; it is not a documented power-loss durability acknowledgement. The
receiver's unmodified PRAGMA synchronous, fullfsync, checkpoint_fullfsync and WAL
mode are recorded, and reopen correctness is stronger than a first query but is
not proof of persistence after sudden power loss. Do not rank checkpointAppliedMs
as equivalent to another engine's explicit fsync acknowledgement.

Storage: per-receiver baseline/total/net include every file in its dedicated
receiver directory, after SDK close, including any remaining WAL/SHM/metadata.
Service data is separately reported as full physical PG cluster baseline/prepared/
final (including shared catalogs and WAL) and source-versus-bucket logical database
sizes. Logical pg_database_size bytes are not allocated physical blocks. No binary,
node_modules, source tree or readiness-client SQLite is counted as service data.
PG CHECKPOINT is used before physical prepared/final snapshots, without VACUUM.
No receiver compaction is requested; normal engine maintenance remains enabled.

Source DB: a new synthetic_admin superuser in a fresh loopback-only SCRAM-authenticated PG
cluster with a fixed synthetic-only password; no connection to any existing Postgres service. Publication powersync,
REPLICA IDENTITY FULL for all model tables, wal_level=logical. Defaults for fsync,
synchronous_commit and full_page_writes stay unchanged and are recorded.
Production role minimization is outside this local synthetic performance fixture.
JWT RS256 signing keys are generated in memory. Service verifies the public key and
audience. Sync Stream authorizes the synthetic subject; no application local writes
are used for receiving replication. All source fields and array ordering survive.

Model granularity: PowerSync replicates rows; nested JSON values serialize to text
in SQLite. Typed scalar columns improve SQL querying but updates still produce row
operations. A JSON column is not a field-level CRDT. Complete-record JSON moves all
record content into one JSON column. Two collection JSON rows make a collection the
unit of change and access control: an inner record is not independently authorized.
Sync Streams select authorized rows; source Postgres RLS is not implicitly applied
to replication. No app-specific indexes or column/row-delta optimization is added.

Primary references (consulted 2026-10-26):
https://docs.powersync.com/client-sdks/reference/node
https://docs.powersync.com/configuration/powersync-service/self-hosted-instances
https://docs.powersync.com/sync/streams/client-usage
https://docs.powersync.com/client-sdks/advanced/custom-types-arrays-and-json
https://github.com/powersync-ja/powersync-service/tree/v1.27.2
https://github.com/powersync-ja/powersync-service/blob/v1.27.2/LICENSE
Service package declares FSL-1.1-ALv2. This run uses the self-hosted source-available
service; enterprise features and hosted services are not needed by this topology.
The recommended documented self-host deployment uses Docker; this benchmark uses
the official npm package to run the identical service entry point without Docker.
