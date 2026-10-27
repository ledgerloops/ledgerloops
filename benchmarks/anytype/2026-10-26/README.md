# Anytype / any-sync synthetic benchmark — 2026-10-26

Results for [ledgerloops/ledgerloops#46](https://github.com/ledgerloops/ledgerloops/issues/46).

**Measured layer: native any-sync LocalOnly object trees with adapter orchestration.** Two authenticated loopback peers run in one Go process, with separate persistent any-store databases. These results do not measure the Anytype application or the official coordinator/consensus/node/file service stack. Those variants remain unmeasured; the Docker daemon was unavailable on the runner.

All three models completed **3 warmups and 10 measured transfers each**. All 39 initial and updated receiver reopen checks passed. Independent Python verification matched the complete fixture and both incremental updates. The fixture contains 21 issues and 111 notes, totaling 415,448 compact JSON bytes; all fields, nested values, nulls, IDs and array order are preserved.

| Model | Trees | Readable p50, ms | SDK flush p50, ms | Flush p95/max, ms | Initial received protobuf bytes |
|---|---:|---:|---:|---:|---:|
| One tree per record | 132 | 133.728 | 133.751 | 151.061 | 602,656 |
| Record operations within collection trees | 2 | 21.779 | 21.798 | 27.971 | 484,960 |
| Opaque collection payloads | 2 | 12.417 | 12.443 | 14.462 | 418,249 |

With 10 samples, nearest-rank p95 equals the maximum. The `collection_blocks` model uses JSON-valued adapter operations; these are not Anytype application blocks or native typed properties. Opaque collections load fastest here, but the note-body update receives about 216 times the protobuf bytes of the record models.

The main timer excludes sender preparation, receiver initialization and connection/authentication setup. It includes full content reconstruction and equality checking. The persistence boundary is the native SDK's `FlushModeFsync` acknowledgement, followed by separate close/reopen correctness checks. This is not a power-loss durability test. Tree IDs and the synthetic space header/ACL/settings are known before timing; discovery is excluded.

The protocol retains native signing, encryption, CID/DAG validation, authenticated transport and full LocalOnly ACL author validation. Consensus acceptor signatures and Anytype application indexes are outside this topology. No source fields or attachment contents come from personal data, and no fixture URLs are fetched.

## Evidence

- [Report](outputs/REPORT.txt): initial and incremental timing, wire bytes, storage totals/baselines/net growth, environment and limitations.
- [Raw results](outputs/results.jsonl), [summary](outputs/summary.json), [independent verification](outputs/verification.json).
- [Adapter](outputs/harness/main.go), [dependency pins](outputs/pins.json), [Go module lock](outputs/harness/go.sum).
- [Fixture](outputs/fixture/fixture.json), [manifest](outputs/fixture/manifest.json), [exact generator](outputs/generate_fixture.py).
- [Environment](outputs/environment.json), [source review](outputs/source-review.json), [build provenance](outputs/build-provenance.json), [coordination log](outputs/coordination.jsonl).
- [Detailed run instructions and measurement boundaries](outputs/RUNNING.txt).

All storage figures count native data/history/index files after flush/close, without compaction. Required external service storage is zero only for the tested direct-peer topology. The official server stack's storage is unmeasured.

## Verify saved results

From this directory, using Python's standard library:

```sh
shasum -a 256 -c checksums.sha256
PYTHONDONTWRITEBYTECODE=1 python3 outputs/verify_results.py
PYTHONDONTWRITEBYTECODE=1 python3 outputs/summarize.py outputs/results.jsonl
```

## Reproduce

The pinned build toolchain is **Go 1.26.10 for macOS arm64**. The adapter uses any-sync commit `9c00aeeb97370712af8e99bde4a81c586651e903`, any-store `v1.0.3`, and the accompanying module lockfiles. A different platform requires its own explicit toolchain pin; numerical results are tied to the recorded runner.

Set `SYNCBENCH_LOCK` to a directory-lock path shared by all heavy benchmark workers on your host. On the original laptop, retain the original shared coordination location documented in `outputs/with_lock.py`. On another runner, for example:

```sh
export SYNCBENCH_LOCK="${TMPDIR:-/tmp}/sync-engine-comparison/measurement.lock"
```

The wrapper acquires the lock with atomic `mkdir`, honors Atomic priority markers, uses bounded waits, and releases only its own token. It never removes another worker's lock.

Run from this directory:

```sh
mkdir -p work
# Builds pinned public dependencies and checks all three models; no measured suite:
PYTHONDONTWRITEBYTECODE=1 python3 outputs/with_lock.py --timeout 600 -- python3 outputs/build_and_run.py --smoke-only
```

For a deliberate complete rerun, first archive the saved results; the runner refuses to overwrite them:

```sh
mkdir -p work/recorded-results
cp outputs/results.jsonl outputs/summary.json outputs/verification.json outputs/environment.json work/recorded-results/
mv outputs/results.jsonl work/recorded-results/original-results.jsonl
PYTHONDONTWRITEBYTECODE=1 python3 outputs/with_lock.py --timeout 600 -- python3 outputs/build_and_run.py
```

Builds, module/compiler caches, fixture input and measurement databases use task-specific `/private/tmp` directories to avoid the Documents file-provider stalls encountered during setup. No existing service is restarted, no vendor cloud is used, and no private databases or personal account keys are needed. Both peers use synthetic in-memory identities; reopen verification retains those synthetic keys within the process.

The recorded host was an Apple M1 Pro with 10 logical CPUs, 16 GiB RAM, macOS 26.6.2 and APFS; `GOMAXPROCS=4`. Six workers shared the laptop and serialized heavy jobs, with Atomic Model H receiving priority. Background load, thermal state, shared runtime/cache state and fixed model order remain caveats for comparisons.

See [PUBLICATION.md](PUBLICATION.md) for publication-only path normalization. The numerical measurements and measured Go adapter are unchanged.
