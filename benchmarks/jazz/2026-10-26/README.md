# Jazz synthetic sync benchmark

Measurements for [ledgerloops issue 45](https://github.com/ledgerloops/ledgerloops/issues/45): three models, each with native Node/Rust persistence and browser persistence. Each variant ran three warmups and ten measured initial transfers into fresh persistent receivers, plus ten issue-title / note-body edit pairs. All initial and final edited fixtures passed complete offline reopen verification.

- [Report](REPORT.md)
- [Machine-readable summary](summary.json)
- [Raw results and both environment records](results/)
- [Exact fixture manifest](fixture/manifest.json)
- [Detailed methodology and limitations](README.txt)
- [Publication transformations](PUBLICATION.md)

## Reproduce on the measured host

The run used macOS ARM64, Node 26.8.1, Python 3, Jazz `2.0.0-alpha.59`, Playwright `1.56.1`, and Chromium Headless Shell `141.0.7390.37` / build 1194. Package versions and integrity hashes are pinned in `package-lock.json`; `browser-artifact.json` pins the browser archive.

```sh
python3 locked.py python3 stage-final.py
```

The shared coordination directory in `locked.py` must exist. It is the same lock used by the other engine workers and yields to Atomic waiting/priority markers. No benchmark is launched by opening these files.

`stage-final.py` installs the exact dependencies and stages the harness under `/private/tmp/sync-benchmark-jazz-20261026-runtime/`. It generates the fixture and selects a fresh timestamped run name. Its results are written below that runtime directory's `harness/results/`. Runtime data moved outside Documents after file-provider reads blocked; source snapshots and actual storage paths are retained in the results. This setup is specific to the measured macOS ARM64 host. On another host configure the lock path, temporary directories and browser artifact before running.

To summarize a new run, use its staged harness:

```sh
cd /private/tmp/sync-benchmark-jazz-20261026-runtime/harness
python3 summarize.py results/<run-name>
```

To audit the published measurements without rerunning any benchmark:

```sh
python3 summarize.py results
shasum -a 256 -c checksums.sha256
```

The audit regenerates `results/summary.json` and `results/report.txt` deterministically. Native durable times are conservative upper bounds through synchronous WAL flush on close, including teardown. Browser `durable_ms` is null because IndexedDB uses relaxed transactions. Incremental durability also remains unmeasured. A reproduced exploratory collection reset timeout remains documented; the final edits use successive unique values rather than claiming a fix.

Jazz Classic CoMaps/CoLists are not measured: this pinned relational package rejects those APIs. The native binary uses RocksDB despite current documentation describing SQLite. See [source evidence](source-evidence.json) and [native provenance](native-provenance.json), including the unpublished dirty-diff hash caveat. Quoted upstream source is MIT-licensed; see [Jazz's license](third-party/Jazz-LICENSE).
