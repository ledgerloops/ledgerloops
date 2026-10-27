# Synthetic Replicache sync benchmark

Contract: https://github.com/ledgerloops/ledgerloops/issues/43

This directory contains the exact public fixture generator, three lossless adapters,
a normal Replicache pull server, a persistent Chromium receiver harness, pinned npm
dependencies and raw measurement artifacts. It uses entirely synthetic records and
a hardcoded synthetic local authorization identity. It never fetches fixture URLs.

## Run

Use Node 26.8.1, Python 3 and the recorded Google Chrome 155.0.8059.85 executable.
The npm lockfile pins all JavaScript dependencies, including Replicache 15.3.0,
Playwright 1.64.1 and esbuild 0.25.12. Chrome is an existing installed binary;
its version is recorded, rather than bundled. Set `CHROMIUM_EXECUTABLE` to use
another browser binary and report it as a different environment.

Run from this directory. These commands acquire the shared atomic mkdir lock:

```sh
export BENCHMARK_DATA_ROOT=/private/tmp/sync-benchmark-replicache-repro
python3 with_lock.py npm ci --ignore-scripts --no-audit --no-fund
python3 with_lock.py python3 generate_fixture.py fixture
python3 with_lock.py npm run build
python3 with_lock.py env RUN_NAME=records-measured MODELS=records node runner.mjs
python3 with_lock.py env RUN_NAME=shared-measured MODELS=shared node runner.mjs
python3 with_lock.py env RUN_NAME=collections-measured MODELS=collections node runner.mjs
python3 combine.py
python3 summarize.py
python3 render_report.py
python3 package_artifacts.py
```

Each model gets 3 warmups and 10 measured fresh persistent receivers, with all
three phases in every run. Set a fresh `RUN_NAME` on reruns: existing stores are
rejected rather than reused. `WARMUPS`, `REPETITIONS`, and `MODELS` support small
smoke runs; those must be reported separately. `LOCK_WAIT_SECONDS` defaults to
50; exit 75 means another worker holds the lock and the command can be retried.
Atomic wait markers and `atomic-model-h-priority.json` yield priority to that worker. Set `MEASUREMENT_LOCK_PARENT`
when reproducing on another machine. No lock belonging to another worker is
removed. The portable default for temporary profiles, bundle, and service stores
is this directory's ignored `.work/` folder. Set `BENCHMARK_WORK_DIR` to move
the bundle and default stores; the build and runner use the same setting.
Set `BENCHMARK_DATA_ROOT` to an isolated directory outside Documents to place
persistent browser profiles and service data there; the actual path is recorded
in each batch environment. The measured batches on this laptop use
`/private/tmp/sync-benchmark-replicache-20261026-01a176de` to avoid the Documents
file-provider path. The smoke run used the original task `work/` directory.

The harness binds an OS-assigned loopback port and closes only its own service
and browser contexts. No external account is involved in measurements.
This repository publication is documented in [PUBLICATION.md](PUBLICATION.md).

## Models

* `records`: 21 `issue/<id>` and 111 `note/<id>` keys, with complete nested JSON.
* `shared`: the same 132 record keys plus 13 shared entity keys (7 users, 4
  labels, 1 repository, 1 milestone). Issue users, assignees, labels, repository,
  milestone and comment authors become references. Notes retain all nested
  content. Different user representations in note collaborators remain intact.
* `collections`: two keys, holding the complete issues and notes arrays.

These are JSON key/value models. Replicache has no Atomic-style typed property
resources. The shared model is an application mapping with explicit references.
The exact fixture's ascending issue/note IDs preserve source array order on
reconstruction; all nested array order, fields and nulls are preserved. Adapter
round-trips are checked before any receiver transfer.

## Measurement boundaries

The sender prepares all three authoritative view versions and cookie-diff
responses outside timing. Version 1 is the complete fixture. Version 2 appends
` [synthetic title update]` to `issues[0].title`. Version 3 also appends
` [synthetic note body update]` to `notes[0].body`. No timestamps or other
fields change. A null cookie gets `clear` plus the complete view; subsequent
pulls send only changed keys. This is the documented Replicache pull protocol,
using the official SDK's default HTTP puller, JSON validation, rebase and storage.

An empty receiver is initialized and closed before baseline disk accounting.
It is reopened, its read transaction and subscription initialized, and an
authenticated `/ready` request establishes transport before timing. Empty
`pullURL`/`pushURL` values keep automatic startup sync from preceding the timer.
The timer starts immediately before `rep.pull({now:true})`. Pull scheduling
uses the public `now` option; persistence scheduling and integrity checks remain
at their defaults. No local mutations or direct inserts deliver payload data.

`observable_ms` ends when a full-view subscription returns all 132 records and
the requested update. `pull_ms` records the public pull promise independently.
Full canonical byte/hash equality is verified outside timing. The receiver is
closed, its browser process stopped, and IndexedDB files measured. The same
profile is reopened with pull requests blocked and the complete fixture checked
again. This is repeated for each phase; before each incremental pull the
receiver is already open and subscribed. Timings exclude update preparation,
startup, authentication, verification, closing and reopening.

## Persistence limitation

`durable_ms` is deliberately null. Replicache 15.3.0 has no public persistence
acknowledgement on `Replicache`. Its default store explicitly opens write
transactions with `{durability: 'relaxed'}`. Neither pull/subscription completion
nor closing is a power-loss durability barrier; closing aborts background
schedulers rather than forcing pending payload persistence.

`persistence_notification_ms` passively observes the engine's existing
`replicache-on-persist:<name>` BroadcastChannel, filtered to the receiver client.
Pinned source shows this is emitted after `persistDD31` and the underlying
IndexedDB `transaction.oncomplete`. It is an internal, version-specific
observation and includes event delivery overhead. It records the default
background persistence boundary without changing engine internals or forcing a
different scheduling policy. Each stage awaits this notification before close
and verifies full content after reopen. Relaxed commit and successful reopen
remain weaker than confirmed power-loss durability; do not rank this column as
equivalent to an fsync acknowledgement.

## Bytes and storage

The server logs exact UTF-8 request/response JSON byte lengths and checks every
cookie transition. CDP independently observes received response-body bytes and
encoded transfer bytes including HTTP response headers. Transport compression
is disabled by absence of a content encoding (`identity`): compressed and raw
body counts are equal. Body counts exclude HTTP headers, TCP/IP framing,
retransmission, readiness requests and browser startup traffic. There is no TLS
on the loopback test. No attachment contents are invented.

Each receiver has a dedicated persistent browser profile and origin containing
only this test's Replicache IndexedDB databases. Storage measurements recursively
sum every file under `Default/IndexedDB`, including LevelDB WAL/logs, history,
metadata and primary indexes. `st_size` gives apparent bytes; `st_blocks * 512`
gives allocated bytes. Baseline and actual totals are always retained alongside
net growth. Initialized-empty baseline precedes a second open, so growth also
includes required metadata for the additional client. Successive phase totals
retain history and reopen metadata. No explicit compaction is invoked; native
browser/LevelDB maintenance can still occur.

Origin-wide `navigator.storage.estimate()` is recorded separately. It is browser
quota accounting, can be padded, and is not a precise allocated-file measure.
General browser profile files, HTTP caches, browser binaries and npm modules
are excluded. Global browser quota infrastructure (outside IndexedDB) cannot
be assigned precisely to one database; this accounting limit is explicit.

Service disk totals cover `views.json` (three authoritative versions) and
`responses.json` (prepared response cache) in the task-owned service directory.
They describe this minimal server implementation, including its deliberately
prepared cache, rather than an optimized production backend. Input fixture and
executables are not counted as extra service data. There is no vendor service.

## Sources

* [Current pull protocol](https://doc.replicache.dev/reference/server-pull)
* [Current API reference](https://doc.replicache.dev/api/classes/Replicache)
* [Pinned Replicache implementation](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache-impl.ts)
* [Pinned public wrapper](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/replicache.ts)
* [Pinned IndexedDB store: relaxed transaction and completion](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/kv/idb-store.ts)
* [Pinned persistence channel](https://github.com/rocicorp/mono/blob/8684fb19c032e25f7f166f40e8acdfb179e6ca87/packages/replicache/src/on-persist-channel.ts)
* [IndexedDB durability hints](https://w3c.github.io/IndexedDB/#transaction-durability-hint)

The npm package's `gitHead` is the pinned source commit above. Its license-key
option is deprecated and ignored in 15.3.0; no private or tutorial key is used.
Current documentation can describe newer source than the published npm package;
the pinned implementation is the authority for this run's persistence behavior.
