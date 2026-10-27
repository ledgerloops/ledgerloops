# Jazz benchmark results

Measured on 2026-10-26 for [issue 45](https://github.com/ledgerloops/ledgerloops/issues/45). Six variants completed 18 warmups, 60 measured initial transfers, and 120 incremental edits. Complete fixtures were verified after offline reopening.

## Initial transfers

Times in milliseconds; n=10 per variant. p95 uses nearest rank and therefore equals the sample maximum. Native durable timing includes graceful close and synchronous WAL flush; browser power-loss durability is unmeasured.

| Runtime | Model | Readable p50 | p95 / max | Native close upper bound p50 | Received WS payload bytes p50 |
| --- | --- | ---: | ---: | ---: | ---: |
| native | embedded | 40.37 | 136.38 | 42.00 | 107,468 |
| native | containers | 160.66 | 165.34 | 163.70 | 193,320 |
| native | collections | 103.84 | 122.01 | 105.52 | 89,691 |
| browser | embedded | 169.55 | 288.00 | unmeasured | 107,430 |
| browser | containers | 575.45 | 686.40 | unmeasured | 193,585 |
| browser | collections | 150.55 | 187.10 | unmeasured | 89,776 |

## Persistence and storage

Native close is a conservative persistence upper bound through the pinned RocksDB `flush_wal(true)` close boundary, not an independent incoming-sync receipt. Browser IndexedDB explicitly requests relaxed transactions; its `durable_ms` is null. Browser graceful-close observations are retained separately in [the detailed report](results/report.txt). A successful normal close/reopen does not establish power-loss survival.

Median receiver apparent / allocated bytes after close. Baseline and total are reported alongside net growth; no explicit compaction is used. Native totals include WAL/history/index/metadata/log files; browser totals include only owned IndexedDB, Local Storage and WebStorage data.

| Runtime | Model | Empty baseline | Post-sync total | Net growth |
| --- | --- | ---: | ---: | ---: |
| native | embedded | 197,743 / 221,184 | 1,472,859 / 1,503,232 | 1,275,116 / 1,282,048 |
| native | containers | 194,519 / 217,088 | 3,675,643 / 3,706,880 | 3,481,124 / 3,489,792 |
| native | collections | 193,811 / 217,088 | 815,901 / 847,872 | 622,090 / 630,784 |
| browser | embedded | 84,342 / 114,688 | 1,399,725 / 1,437,696 | 1,315,381 / 1,323,008 |
| browser | containers | 74,921 / 102,400 | 1,467,322 / 1,503,232 | 1,392,400 / 1,400,832 |
| browser | collections | 72,385 / 102,400 | 993,311 / 1,028,096 | 920,926 / 925,696 |

Required sender and Core service totals cover the entire variant experiment, including the warmups, receivers and incremental tests. Exact apparent / allocated bytes:

| Runtime | Model | Sender | Core service |
| --- | --- | ---: | ---: |
| native | embedded | 2,137,429 / 2,158,592 | 1,584,712 / 1,642,496 |
| native | containers | 5,870,249 / 5,894,144 | 3,887,452 / 3,948,544 |
| native | collections | 4,970,634 / 4,993,024 | 5,066,955 / 5,128,192 |
| browser | embedded | 2,163,988 / 2,183,168 | 1,617,267 / 1,671,168 |
| browser | containers | 5,897,077 / 5,918,720 | 3,926,062 / 3,981,312 |
| browser | collections | 4,970,706 / 4,993,024 | 5,105,444 / 5,160,960 |

## Incremental edits

Each model received ten title/body pairs while subscribed. The first edit appends a unique suffix; later edits replace one suffix digit. Every operation changes one source field. The full expected fixture is verified, and the final edited fixture is verified again after upstream-blocked reopening. Native fine-field updates are much smaller on the wire than replacing a whole collection JSON column. These values include default compression and protocol metadata.

| Runtime | Model | Field | Convergence p50 ms | Received bytes p50 | First suffix append bytes |
| --- | --- | --- | ---: | ---: | ---: |
| native | embedded | title | 17.11 | 98 | 1,098 |
| native | embedded | body | 17.48 | 98 | 1,025 |
| native | containers | title | 18.88 | 102 | 2,045 |
| native | containers | body | 18.88 | 102 | 923 |
| native | collections | title | 72.84 | 18,002 | 18,078 |
| native | collections | body | 102.67 | 70,955 | 70,986 |
| browser | embedded | title | 22.60 | 99 | 1,108 |
| browser | embedded | body | 25.22 | 98 | 1,037 |
| browser | containers | title | 63.22 | 102 | 2,054 |
| browser | containers | body | 62.87 | 103 | 926 |
| browser | collections | title | 55.48 | 18,026 | 18,104 |
| browser | collections | body | 130.20 | 71,006 | 71,032 |

## Environment and limits

Apple M1 Pro, 10 logical CPUs, 16 GiB RAM, macOS 26.6.2 / Darwin 25.6.0 ARM64, internal APFS SSD, Node 26.8.1, Chromium 141.0.7390.37. No container/cgroup quotas. The APFS volume was nearly full. A shared atomic directory lock serialized heavy work across six tasks; OS activity, cache state and thermal conditions remained uncontrolled. Cross-engine rankings are provisional.

The native Core, sender and receiver are separate engine stores hosted in one Node process and connected through actual loopback TCP/WebSocket replication. Browser receivers run in a separate Chromium process. Sender import, receiver startup and connection/authentication are excluded from the main timer. An empty remote-ready query establishes the transport before subscribing to the dataset.

Wire counters distinguish WebSocket payload, TCP-stream bytes including WS framing, and declared decoded/encoded Jazz channel payload bytes. Jazz uses internal Zstandard compression; WebSocket RSV1 is a separate counter. All measured frame parses succeeded. IP/TCP headers, ACKs, retransmissions and unrelated traffic are excluded. No auth/integrity settings are disabled.

The deterministic fixture is 415,448 compact JSON bytes, 21 issues and 111 notes, SHA-256 `9b8f0b8e52345b95d0bd3434d125ef2dc1a688ad537c0c3a1ccc8348981a101a`. Embedded rows retain title/body columns plus complete nested JSON; separate containers use 1,215 application-linked relational rows; collection JSON uses two rows. All source fields, IDs, nulls and array order survive reconstruction. No attachment URLs are fetched.

Limitations: the classic CoValue APIs are unsupported in this relational release; native build provenance contains an unpublished dirty-diff hash; browser and incremental strict durable timings are unavailable. An exploratory attempt to restore the original note body in the two-collection model timed out after 120 seconds despite sender global confirmation. The receiver retained the edited body. Final measurements use successive unique edit values and do not claim the reset problem was fixed. See [diagnostics](results/diagnostics.json) and `reset-repro.mjs`.

See [README.txt](README.txt) for exact measurement boundaries, defaults, authorization, durability and source references; [raw results](results/results.json) for every run, storage file inventory and both environment records; and [PUBLICATION.md](PUBLICATION.md) for publication-only path transformations.
