# Rocicorp Zero benchmark results

Measurements implement [ledgerloops issue 44](https://github.com/ledgerloops/ledgerloops/issues/44) using the exact 415,448-byte synthetic fixture. All three requested models passed 3 warmups and 10 measured transfers each, with complete SHA-256 verification after offline browser reopening. Native relaxed IndexedDB persistence is reported separately from readability; strict durable completion remains unmeasured.

## Initial transfers

Times are milliseconds. p95 uses nearest rank over 10 measured observations and equals the sample maximum. Persistence is the weaker native IDB transaction observation described in [README.md](README.md).

| Model | Readable p50 | p95 and max | IDB persistence p50 | p95 and max | Received application bytes p50 | Received transport bytes p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| typed | 29.20 | 31.50 | 565.20 | 569.40 | 421,509 | 421,537 |
| record | 29.70 | 32.50 | 565.25 | 571.00 | 424,780 | 424,805 |
| collection | 24.95 | 26.20 | 550.55 | 570.40 | 416,108 | 416,134 |

## Untimed preparation

Median milliseconds across the 10 measured receivers. Zero open includes local store initialization and transport/authentication; these steps and browser startup occur before subscription timing. Sender preparation is one untimed preparation per model.

| Model | Browser startup p50 | Receiver script p50 | Zero open and connection p50 | Sender preparation |
| --- | ---: | ---: | ---: | ---: |
| typed | 393.59 | 48.62 | 25.00 | 13473.54 |
| record | 396.84 | 53.71 | 24.05 | 13650.27 |
| collection | 392.66 | 51.25 | 23.55 | 13666.65 |

## Receiver storage

Exact bytes from measured receiver 1 for each model, after native close and browser shutdown. Values are apparent / allocated bytes; raw JSON contains baseline, total and net for every measured receiver. IndexedDB, WebStorage quota files, Local Storage identity and Session Storage metadata are counted; other browser profile files are excluded.

| Model | Initialized empty | After sync | Net growth |
| --- | ---: | ---: | ---: |
| typed | 52,240 / 98,304 | 538,333 / 589,824 | 486,093 / 491,520 |
| record | 52,253 / 98,304 | 541,416 / 593,920 | 489,163 / 495,616 |
| collection | 52,313 / 98,304 | 202,260 / 258,048 | 149,947 / 159,744 |

## Incremental changes

One subscribed receiver receives a deterministic 26-byte suffix to the issue title, then a 25-byte suffix to the note body. Convergence includes harness dispatch and the normal PostgreSQL transaction commit. Each update passes full equality verification, followed by offline reopening of the final changed fixture. These are individual observations, not ten-run percentiles.

| Model | Change | Readable ms | IDB persistence ms | Received application bytes | Received transport bytes |
| --- | --- | ---: | ---: | ---: | ---: |
| typed | issues.title | 30.10 | 452.80 | 3,820 | 3,828 |
| typed | notes.body | 7.20 | 463.50 | 3,149 | 3,157 |
| record | issues.title | 23.20 | 448.50 | 3,846 | 3,854 |
| record | notes.body | 7.40 | 464.60 | 3,174 | 3,182 |
| collection | issues.title | 33.10 | 474.60 | 83,464 | 83,478 |
| collection | notes.body | 25.40 | 467.20 | 332,439 | 332,453 |

## Required service storage

Exact apparent / allocated bytes. PostgreSQL totals include upstream, CVR and change databases, system catalogs, WAL and normal metadata. These final totals cover the entire model experiment, including all warmups, measured receivers and the incremental receiver. Empty PostgreSQL baselines include initialized databases. Cache preparation means its fully prepared replica before any clients; cache final totals include replica, WAL, WAL2 and shared-memory files after shutdown. No binaries or dependency directories are included.

| Model | Empty PostgreSQL cluster | Final PostgreSQL cluster | PostgreSQL net | Prepared cache files | Final cache files |
| --- | ---: | ---: | ---: | ---: | ---: |
| typed | 80,228,338 / 80,310,272 | 83,096,223 / 83,193,856 | 2,867,885 / 2,883,584 | 782,848 / 786,432 | 832,288 / 835,584 |
| record | 80,228,340 / 80,310,272 | 82,965,099 / 83,066,880 | 2,736,759 / 2,756,608 | 803,328 / 806,912 | 852,768 / 856,064 |
| collection | 80,228,348 / 80,310,272 | 82,473,386 / 82,575,360 | 2,245,038 / 2,265,088 | 659,968 / 663,552 | 1,482,000 / 1,482,752 |

| Model | Upstream database bytes | CVR database bytes | Change database bytes |
| --- | ---: | ---: | ---: |
| typed | 8,607,411 | 9,041,587 | 8,017,587 |
| record | 8,566,451 | 8,951,475 | 8,017,587 |
| collection | 8,533,683 | 8,345,267 | 8,165,043 |

Database page sizes above use `pg_database_size`; allocated cluster totals are reported separately. Storage is not a per-client server estimate.

## Environment and interpretation

Measured on 2026-10-26 UTC: Apple M1 Pro, 10 logical CPUs, 16 GiB RAM, macOS 26.6.2, Darwin 25.6.0, arm64, APFS. Node v24.22.1, postgres (PostgreSQL) 17.11 (Homebrew), Chromium 156.0.8078.4, Zero 1.11.3. Native processes; no container or cgroup CPU/RAM cap. Zero runs one sync worker. PostgreSQL fsync, full_page_writes and synchronous_commit remain enabled.

The shared atomic directory lock serializes sustained work across six tasks. Atomic Model H received priority before these full runs. Browser startup, connection/authentication, sender import and replica preparation are excluded from transfer timing and recorded separately where applicable. OS activity, file-provider behavior, disk fullness and thermal state remain uncontrolled. Storage paths and filesystem capacity at run start appear in each raw environment record. These are single-host observations with instrumentation overhead, not a cross-engine ranking.

WebSocket payload and TCP stream counts are separate. HTTP upgrade headers are excluded from transfer snapshots. No WebSocket compression extension was negotiated in these runs, so the transport count is uncompressed application payload plus WebSocket framing. Captured handshakes are retained in raw results. Neither count includes IP/TCP headers or other service traffic.

Typed columns preserve scalar queryability, complete-record JSON stores preserve one entity per row, and collection JSON stores preserve two coarse entities. Observed incremental byte counts show the practical cost of these boundaries. Source inspection of Zero 1.11.3 `client-handler.js` confirms that a `put` row patch sends row contents; changing a scalar column does not imply a scalar-only browser payload. No model uses a first-page limit.

Strict power-loss durability has no measured value in this adapter. Relaxed IndexedDB transaction completion and successful normal-close reopening are weaker boundaries. See [README.md](README.md) for instrumentation, authorization, storage accounting, source references and reproducible commands.

## Artifacts

- [Runnable adapter and commands](README.md)
- [Exact fixture manifest](fixture/manifest.json)
- [Dependency lockfile](package-lock.json)
- [Machine readable summary](summary.json)
- [typed raw measurements](results/2026-10-26T06-58-04-223Z.json)
- [record raw measurements](results/2026-10-26T06-59-01-812Z.json)
- [collection raw measurements](results/2026-10-26T07-00-21-635Z.json)
