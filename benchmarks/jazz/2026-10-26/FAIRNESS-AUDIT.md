# Jazz benchmark fairness and persistence audit

Read-only audit, 2026-10-27. Scope: the Jazz results published under `benchmarks/jazz/2026-10-26`, publication commit `c3497a4f373eafe5fb3940922c96c74bad39df4f`, considered against the comparison coordinator's snapshot `104eb59e4ef50b4375413dc4192083c5f0c4b0b3`. This document audits Jazz; it does not independently establish the other five engines' guarantees. No engine imports, builds, benchmark reruns, database opens, or publication were performed during this audit. Original measurements and adapters are preserved.

## Findings that affect comparison

The published Jazz experiment already uses persistent stores and verifies every initial fixture after offline reopening. Adding persistence is therefore a clarification of the comparison endpoint, rather than adding persistence to an in-memory Jazz test. A useful comparison must report observable convergence, graceful close plus offline restart verification, and any explicit durable receipt separately.

Native initial `durable_ms` includes graceful close and a source-backed synchronous RocksDB WAL flush. It is a conservative upper bound, with an important unpublished-source caveat below. Browser `durable_ms` is correctly null: IndexedDB requests relaxed durability. Both runtimes passed clean offline reopen checks; neither was subjected to power interruption, and native reopening reused the same Node process. Incremental samples have no receiver durable receipt; only the final edited fixture was checked after close/reopen.

The headline small-edit median mostly measures one-byte replacements in an already synchronized stream. It must not be presented as the cost of appending a fresh suffix, arbitrary text insertion, or whole-document replacement in every engine. A separate collection reset failed twice and remains unresolved. The laptop's resource pressure makes timing rankings provisional even when the shared benchmark lock was observed.

## Persistence acknowledgement boundaries

| Boundary | What the existing test establishes | What it does not establish |
| --- | --- | --- |
| Full subscription callback | Reconstructed complete fixture matches the expected data. Native includes canonicalization and SHA-256; browser includes canonical equality. | An independent receiver fsync acknowledgement. |
| Sender `.wait({tier:'global'})` | Sender's write reaches its global transaction boundary. Imports wait on this before transfer tests; increments record it separately. | That another client's received copy has crossed its own power-loss boundary. |
| Native `await session.close()` | Public lifecycle drains and closes the persistent runtime. Pinned source leads to RocksDB `flush_wal(true)`. All initial runs then reopen offline and match. | A timing for only the flush; abrupt-process restart or physical power-loss survival; proof that unpublished native source changes preserve the source-derived guarantee. |
| Browser session and Chromium context close | Graceful shutdown followed by a new Chromium process/profile reopen, upstream blocked, reproduces complete data. | Strict storage-device durability. IndexedDB transaction completion is relaxed. |
| Incremental final offline reopen | The final state after all 20 operations per variant survives clean close/reopen. | Per-operation close/restart timing or durable receipt. |

Native provenance identifies RocksDB, not the SQLite implementation described by other Jazz revisions. At the binary-associated source commit `204dc5b9c164de78267d63b35624e28848402790`, NAPI opens persistent user storage with `WalNoSync` (`crates/jazz-napi/src/lib.rs:3824`). WAL remains enabled; `WriteOptions.sync` is false for that mode. The storage synchronously flushes after 64 **backend write batches**, not 64 application rows, and on explicit close. Background `wal_bytes_per_sync` is explicitly not a durable receipt. `FullSync` exists in Rust but is not selected by the measured public user-session path; changing Rust or private bindings would create a different experiment.

The close chain is supported by the installed adapter's `NativeRuntimeAdapter.close` (waits accepted work, then awaits binding close), the package's pollable-close wrapper, pinned NAPI `close_owned_napi_runtime`, DB lifecycle `close`, node state `close` (flush and close), and storage `close -> flush_write_boundary -> flush_wal(true)`. This is a software sync boundary subject to filesystem/device guarantees; no physical power-failure validation was performed.

There is a misleading public wrapper comment: `NodeUserRuntimeSource.flush()` says native commits already cross the durability boundary, but its body is empty. Calling that wrapper supplies no additional fsync. `db.shutdown({waitForSync:true})` is a supported outgoing-write barrier: its type says it waits for pending writes to reach Core, and Rust enumerates this author's pending transactions. It cannot be relabeled as a receipt for arbitrary incoming subscription data. Use graceful session close for the supported end-to-end native upper bound.

The browser page store atomically writes pages plus root metadata in one IndexedDB transaction, awaits transaction completion, and explicitly uses `{durability:'relaxed'}` (`indexeddb-page-store.js:464–525,611–612,734–739`). Internal worker `flushLocal()` methods are not a supported public strict-fsync configuration. No public strict IndexedDB receiver-flush acknowledgement was established in the inspected alpha.59 APIs. A browser durable field must remain null unless a supported, stronger API is separately demonstrated; do not patch the transaction option and call it the original default.

Node user sessions omit `initialSyncFlushEvery`, leaving the core override absent; storage still has its 64-write-batch WAL cadence. The browser runtime supplies a default initial-sync cadence of 512. Those are different batching layers and units. They do not imply that all readable callbacks have the same persistence guarantee. Account credentials are stored outside the engine: native `fileAccountStore` uses ordinary `fs.writeFile` without fsync, and browser uses localStorage. Accounts are initialized before the timed transfer, so the WAL timing specifically concerns the dataset/runtime store, not a separately proven power-safe fresh-account bootstrap.

## Native binary identity and source reproducibility

All three Jazz packages are pinned to `2.0.0-alpha.59`, with npm tarball integrity in the lockfile. The measured native manifest records:

| Input | Recorded value |
| --- | --- |
| HEAD | `204dc5b9c164de78267d63b35624e28848402790` |
| HEAD tree | `55c3449a8a05153ffb84c82174e7900096dded6d` |
| Dirty-diff hash | `0437c0384997d1a071aafea634c6ecb43f0d8a16f372881755e4afaf591f18b1` |
| Darwin arm64 binary SHA-256 | `f22b6162edb14627d70504bfcb9e29102da556f47d80fc1e92941e76c0185b41` |
| Native artifact fingerprint | `b3dbc494a524515cc337fe323169de529dba6b171600bf385ae76823fe706982` |
| Build | release, default features, `aarch64-apple-darwin`, rustc 1.93.1 |

These identify the distributed artifact; they do not supply its complete source. The installed entrypoint checks the binary's exported fingerprint against the packaged expected fingerprint. It does not compute the manifest's full binary SHA on import. No large binary was rehashed or loaded during this audit; the SHA above is the recorded provenance value.

Pinned `dev/artifacts/provenance.mjs:547–554` hashes a binary Git diff against HEAD plus porcelain status, with generated-artifact exclusions. The hash cannot be inverted into a patch. Untracked names in status also do not substitute for their file contents. Thus the pinned Rust files are primary evidence for the associated commit, not proof of the exact unpublished delta inside the distributed binary. This caveat applies to source-derived behavior, including durability and the reset failure.

Two auditable paths are available for a future, separately labeled run:

1. Obtain the release producer's complete source snapshot or binary patch against the recorded HEAD, including all relevant untracked content, and its build environment/flags. Preserve Cargo.lock, rust-toolchain, package lock, compiler/linker/SDK inputs, generated declarations and manifests. Check their recorded hashes and reproduce the packaged fingerprint/artifact; explain any non-bit-identical output.
2. Build a clean, immutable commit using its checked-in release build flow, and rebuild matching SDK/WASM/native packages as needed for their artifact fingerprints and ABI. At this commit the release producer supports `node dev/artifacts/build.mjs napi release`; `pnpm --filter jazz-napi build` delegates through its checked-in wrapper. Use the revision's complete packaging flow, not a replacement `.node` dropped under unrelated npm JS. Publish the source revision and resulting manifests as a **new clean-build variant**. A clean build of HEAD is not an exact reproduction of the dirty npm release.

Neither path was executed here. Cached npm artifacts can repeat the distributed-artifact experiment without compilation, but cannot resolve missing source provenance.

## Collection reset correctness failure

Two exploratory native collection runs followed this sequence: append ` [benchmark-title]` to issue 0 title; uppercase the first character of note 0 body; restore the original title; restore the original body. The first three converged. The fourth reached sender global confirmation, but the receiver did not match within 120,000 ms. Expected original fixture hash was `9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a`; observed hash was `6a2abd9a715a96ce7895f778127bc549643937ccb1430336253843358ec881d2`, corresponding to restored title with the edited note body retained. Both local logs contain that timeout/hash; the published diagnostics retain the outcome.

`mutationFor('collections')` clones the original target collection and changes the specified field. Because title and body are in different collection rows, that construction is consistent with this four-step intended state; it does not itself explain a missing body restoration. The observer compares complete reconstructed data, so sender acceptance alone cannot mask the mismatch. The existing evidence does not distinguish stale subscription delivery, server/current-state behavior, storage/history behavior, or an adapter/runtime issue. No root cause or browser reproduction is established. Final sequential unique-value measurements passed, but they do not demonstrate that restoration works or repair this failure.

The preserved public-API `reset-repro.mjs` includes the original initial sync, clean close/offline reopen/reconnect, and four operations. Before a broad future run, execute it once under the shared lock in a new store and collect sender read-back, receiver subscription result, receiver fresh local query, and a fresh independent receiver after each globally accepted step. After a failure, block upstream before reopen and retain the stale hash. This distinguishes paths without changing internals. Keep timeouts/failures as outcomes, outside successful latency percentiles.

## Exact update trace and model costs

For repetition `r=0..9`, the final measured trace sets issue 0 title to the original title plus ` [benchmark-title-r]`, then note 0 body to the original body plus ` [benchmark-body-r]`. These are literal decimal single digits in the template. The first operations insert 20 and 19 UTF-8 bytes respectively. Repetitions 1–9 remove one byte and insert one byte. Each variant has one continuous 20-operation stream, not ten independent fresh-stream edit trials.

| Runtime/model | Title WS bytes: first / median | Body WS bytes: first / median |
| --- | ---: | ---: |
| Native embedded | 1,098 / 98 | 1,025 / 98 |
| Native containers | 2,045 / 102 | 923 / 102 |
| Native collections | 18,078 / 18,002 | 70,986 / 70,955 |
| Browser embedded | 1,108 / 99 | 1,037 / 98 |
| Browser containers | 2,054 / 102 | 926 / 103 |
| Browser collections | 18,104 / 18,026 | 71,032 / 71,006 |

The public API replaces a scalar title/body column in embedded mode; it replaces the target object's complete `scalars` JSON column in containers mode; it replaces the entire issues/notes array JSON column in collections mode. Canonical API patches are respectively 86/2,558 bytes, 3,311/2,715 bytes, and 83,257/332,236 bytes for title/body. A one-field logical change is consequently very different engine work across representations. Fine-grained transport results do not show that the application issued a byte-diff API.

Internal wire compression is Zstandard, separate from WebSocket compression (RSV1 is zero). Pinned channel codecs preserve stream history across flushes, use a 64 KiB window, and configure Zstd level 3. Declared decoded channel bytes, encoded channel bytes, WebSocket payload and framed TCP-stream bytes should all remain visible. Initial native decoded channel payload medians are 697,619 / 2,991,544 / 420,245 bytes for embedded/containers/collections, despite compressed WS payload medians of 107,468 / 193,320 / 89,691. Compression, stream history and model representation plausibly explain a large part of the gap; the audit does not causally apportion it or infer a specific undocumented JSON diff algorithm.

Incremental wire snapshots are taken after both receiver convergence and sender global confirmation complete. Observable time stops at the receiver callback, so wire counts may include control traffic until the later acceptance boundary. Browser incremental timing includes Playwright IPC to the host; browser initial timing uses its own performance clock. Those boundaries must be matched or exposed in any comparison.

## Other work included or excluded

The relational alpha uses 132 embedded rows, 1,215 independently addressed object/array container rows linked by application paths, or two collection JSON rows. Container links are not native foreign keys or classic CoValues. Default current-state/history/index/metadata work remains enabled; no application indexes or explicit compaction were added. Sender import batches 16 writes and waits for global acceptance outside the main transfer timer. These shapes change per-row metadata, index fanout, subscription work, authorization work and history size. This is evidence of representation effects within this release, not a blanket conclusion about classic Jazz CRDTs.

Normal synthetic local-first users, identity proofs and explicit allow policies are used, without bypassing authorization. Connection/authentication and an empty ready query happen before the timed subscription. Local HTTP/WebSocket has no TLS; no optional application encryption is enabled. Comparing with an engine that includes TLS, different identity/integrity work, import, connection setup, or a different persistence endpoint would mix workloads.

Core, sender and native receiver use separate persistent stores but share one Node process; browser receivers use separate Chromium processes and a SharedWorker. This changes scheduling, process/global state, IPC and memory pressure. OS cache state is uncontrolled. Storage includes default native WAL/history/index/account/log metadata, while browser measurement includes only IndexedDB, Local Storage and WebStorage, not the whole profile or Session Storage. Sender/Core totals are final whole-experiment totals, not a per-receiver marginal cost. No immediate file-size reading should be interpreted as compacted live-data size.

## Laptop contention and future serial execution

The coordinator reports that at **2026-10-27 10:34 local (Europe/Amsterdam)** aggregate CPU was about 39% busy, memory about 15 GB of 16 GB used, and compressed memory about 6.9 GB; the shared lock was absent. This is a reported later snapshot, not telemetry captured during the October 26 measurements. It establishes that lock absence does not imply an idle laptop. It does not prove how much any particular original sample was delayed. Memory compression, swap/cache churn, browser process startup and nearly full APFS storage can disproportionately affect different engines and models.

All future heavy preparation, builds, imports and measurements must run **serially** under the atomic-directory lock at `$HOME/Documents/Codex/2026-10-24/th/work/sync-engine-comparison/measurement.lock`, with PID/token ownership and no automatic stealing. The existing `locked.py` supplies ownership checks. Inspect termination handling before reuse: it signals the immediate child and releases in `finally`; a future supervisor should wait for the complete child process group to exit before releasing, so orphan work cannot overlap the next worker.

Record timestamp, lock owner, aggregate CPU samples, top CPU consumers, `vm_stat` counters, compressed memory, swap usage (`sysctl vm.swapusage`), `memory_pressure` reporting, and free filesystem space immediately before and after every variant; retain deltas and available thermal information. Use report-only commands, not memory-pressure stress modes. A short idle baseline and periodic lightweight sampling help expose work that starts mid-run. Defer measurement if compression/swap activity or unrelated heavy work continues. Agree an idle gate across engines; do not selectively discard slow samples after observing their outcome. Retain rejected-start telemetry. This lock serializes cooperating workers; it cannot reserve OS or user activity.

## Smallest useful supplemental experiment (proposed, not run)

1. Run the single native collection reset diagnostic first. Stop broad collection timing if correctness still fails. Its browser counterpart is a new diagnostic, not a claim about the old native failure.
2. Reuse the pinned cached distributed artifacts. Under one lock, run one warmup plus three fresh-receiver measured transfers for each of the six Jazz variants (24 initial transfers total). This is a small sensitivity check, insufficient for stable tail rankings. Preserve raw observations; do not advertise a three-sample p95 as a reliable tail estimate. Use the same fixture, schema, default auth/compression, exclusions and full data validation as the original.
3. Record `t_readable`, awaited public close completion, and blocked-upstream reopen/full verification. Label native close as a source-qualified WAL-sync upper bound, browser close as clean-restart evidence, and strict browser durability null. Close/reopen each receiver in a new process where practical and label the topology change; avoid pooling new-process timings with the original native same-process results. No private flush or global OS `sync` should substitute for a supported per-engine acknowledgement.
4. On a dedicated fresh receiver, replay the original exact 20-operation trace for comparability, tagging the first append and later one-digit replacements separately. On a second dedicated fresh receiver, use a coordinator-agreed repeated-append trace: start from original data and append the literal ` [benchmark-title]` (18 bytes) or ` [benchmark-body]` (17 bytes) to the **current** value each step, three title/body pairs. Persist the manifest with full old/new values and hashes; every engine/model must consume that same manifest. Reset codec/store history identically between the two trace classes. Never silently replace the failed restoration trace with these traces.
5. For per-update persistence, use a separate tiny stream of three operations on fresh receivers: wait for full convergence, await public close, block upstream, restart and verify after each operation. Report the teardown/restart overhead separately and any unsupported stronger durability as null. This gives meaningful sync-plus-clean-restart evidence without conflating teardown with sustained subscribed edit latency.

Only expand to the original 3+10 repetitions once correctness, idle pressure, trace identity and endpoint definitions are agreed across all engines. A true matched power-loss-durable browser/native comparison remains unavailable through the audited public default APIs; do not force it by altering internals.

The current adapter uses `JAZZ_REPETITIONS` for both initial-transfer count and incremental pair count. The proposed 3-transfer/10-pair protocol therefore requires a small, separately saved adapter change to accept distinct counts and trace manifests; it is not achieved by setting only that environment variable. Keep original adapter snapshots and identify the supplemental adapter with new hashes. All proposed engine operations use the existing public session, update, wait, subscribe, query, reconnect and close APIs.

## Evidence and cached assets

Published primary artifacts: [report](https://github.com/ledgerloops/ledgerloops/blob/c3497a4f373eafe5fb3940922c96c74bad39df4f/benchmarks/jazz/2026-10-26/REPORT.md), [raw results](https://github.com/ledgerloops/ledgerloops/blob/c3497a4f373eafe5fb3940922c96c74bad39df4f/benchmarks/jazz/2026-10-26/results/results.json), [source evidence](https://github.com/ledgerloops/ledgerloops/blob/c3497a4f373eafe5fb3940922c96c74bad39df4f/benchmarks/jazz/2026-10-26/source-evidence.json), [reset reproducer](https://github.com/ledgerloops/ledgerloops/blob/c3497a4f373eafe5fb3940922c96c74bad39df4f/benchmarks/jazz/2026-10-26/reset-repro.mjs).

Pinned upstream evidence, with the dirty-binary caveat: [RocksDB persistence](https://github.com/garden-co/jazz/blob/204dc5b9c164de78267d63b35624e28848402790/crates/jazz-storage-rocksdb/src/lib.rs#L970), [NAPI close](https://github.com/garden-co/jazz/blob/204dc5b9c164de78267d63b35624e28848402790/crates/jazz-napi/src/lib.rs#L3742), [DB close and pending-write scope](https://github.com/garden-co/jazz/blob/204dc5b9c164de78267d63b35624e28848402790/crates/jazz/layers/db/src/db/lifecycle.rs#L620), [persistent channel codec](https://github.com/garden-co/jazz/blob/204dc5b9c164de78267d63b35624e28848402790/crates/jazz-compression/src/stream.rs), [provenance algorithm](https://github.com/garden-co/jazz/blob/204dc5b9c164de78267d63b35624e28848402790/dev/artifacts/provenance.mjs#L547), [release producer](https://github.com/garden-co/jazz/blob/204dc5b9c164de78267d63b35624e28848402790/dev/artifacts/build.mjs#L480).

Local root: `$HOME/Documents/Codex/2026-10-26/sync-benchmark-jazz`. Companion `FAIRNESS-AUDIT-EVIDENCE.json` records extracted raw update fields, reset outcome, and source hashes. Pinned Rust source caches are under `work/pinned-reference/` (slashes replaced with `__`); installed JS evidence is under the cached runtime below. `work/native-collections-debug.log` and `work/native-measured.log` preserve both reset failures.

Available at audit time, by file metadata only; no executables were launched:

- `/private/tmp/sync-benchmark-jazz-publication-20261027/`: complete published text/results copy.
- `/private/tmp/sync-benchmark-jazz-20261026-runtime/harness/`: installed locked harness/dependencies. `node_modules/jazz-napi/jazz-napi.darwin-arm64.node` is 73,790,048 bytes; `node_modules/jazz-wasm/pkg/jazz_wasm_bg.wasm` is 19,342,148 bytes.
- `/private/tmp/sync-benchmark-jazz-20261026-runtime/browsers/chromium_headless_shell-1194/chrome-mac/headless_shell`: cached Chromium 141.0.7390.37, 146,794,928 bytes; official cached ZIP also present. Use Playwright 1.56.1/build 1194 and explicit local WASM/broker URLs from the final browser adapter.

These are temporary caches and may be removed externally. Reverify manifest identities before any later authorized run. The publication's source snapshots include documented home-path redaction; their current checksums must not be confused with original unredacted measured-source hashes.
