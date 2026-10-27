# Publication copy

These measurements were collected on 2026-10-26 for
[ledgerloops/ledgerloops#43](https://github.com/ledgerloops/ledgerloops/issues/43)
and published at the user's request on 2026-10-27. Numerical measurements,
fixture bytes, dependency pins and full-content correctness evidence are unchanged.

Personal home-directory prefixes in recorded paths are represented as `$HOME`;
the remainder of each recorded path is preserved. The shared-lock helper resolves
the current home directory, and still supports `MEASUREMENT_LOCK_PARENT`.

For this repository layout, the build and runner use a variant-local `.work/`
directory (or `BENCHMARK_WORK_DIR`) instead of the original task's `../../work/`.
`BENCHMARK_DATA_ROOT` still controls receiver and service stores. These are path
adaptations for future runs; no measurements were rerun for publication.
The packaging helper excludes `.work/`. `SHA256SUMS` describes this publication
copy and is regenerated after the documented path substitutions. The live lock
audit log is retained but is excluded from static checksums.

Installed dependencies, browser profiles, binaries and temporary service stores
are excluded. The authorization value in browser.js and runner.mjs is a public,
synthetic test identity. Confirmed power-loss durable times remain unavailable;
the report explicitly distinguishes the weaker persistence notification.
