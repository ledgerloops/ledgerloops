# Run the PowerSync benchmark

[REPORT.md](REPORT.md) contains the measurements and their limits. [README.txt](README.txt) documents the timers, wire instrumentation, storage accounting, models and authorization in detail.

The fixture is entirely synthetic: 21 issues and 111 notes, 415,448 compact JSON bytes. Dependencies are pinned in `package-lock.json`; no vendor account or Docker daemon is required.

## Prerequisites

The measured host used macOS arm64, Node.js **24.22.1**, PostgreSQL **17.11** (`initdb`, `postgres`, `pg_ctl` on PATH), and Python 3. The official PowerSync service and Node SDK run natively.

## Commands

Run from this directory:

```sh
export PATH="$HOME/.nvm/versions/node/v24.22.1/bin:/opt/homebrew/bin:$PATH"
python3 generate_fixture.py fixture
python3 with_measurement_lock.py python3 isolated_runtime.py
python3 collect_results.py
```

The wrapper serializes installation and measurement with the shared `measurement.lock` directory. On the original laptop it defaults to `$HOME/Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock`. On another host, export `BENCH_LOCK_PATH` to the path agreed by all workers before running. Never remove another worker’s lock or priority marker.

`isolated_runtime.py` stages the code and exact lockfile under a fresh `/private/tmp/powersync-issue42-runtime-*` directory, installs with `npm ci` using empty task-local npm configuration, validates the byte counter, then execs the benchmark while retaining the same lock owner. Measured database stores also remain outside Documents. This avoids file-provider read stalls. The actual code and data paths are recorded with each run.

`collect_results.py` copies only result JSON back, runs the fixture/count/storage/byte audit, and writes `results/<UTC>/summary.json`. It expects the full 39 initial transfers and 60 updates. The runtime directory is recorded in `work/primary-runtime-location.txt`; it is not a published database snapshot.

## Validation

```sh
node verify-wire.mjs
python3 verify_results.py
python3 summarize.py
shasum -a 256 -c checksums.sha256
```

The last command checks the published artifact snapshot. Rerunning the benchmark creates new results; regenerate checksums if intentionally updating that snapshot.

The main runner uses real service replication into native persistent SQLite. It performs 3 warmups and 10 measured fresh receivers for each model, then ten issue-title/note-body update pairs on an existing subscribed receiver. Initial and changed content is verified after close/reopen. It does not copy files or insert fixture content directly into receiver tables.

The strict durable time and transport-preestablished-only time remain unmeasured. SQLite’s default NORMAL synchronization is weaker than an explicit power-loss durability acknowledgement, and the SDK reconnects its WebSocket when a subscription is added. See the report before comparing its checkpoint times with other engines.
