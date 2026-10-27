# Publication copy

Measured on 2026-10-26 for [issue #46](https://github.com/ledgerloops/ledgerloops/issues/46), published at the user's request on 2026-10-27.

The report, raw measurements, synthetic fixture, dependency versions and correctness evidence are preserved. The measured `outputs/harness/main.go` is byte-for-byte unchanged and matches `outputs/build-provenance.json`.

Personal home-directory prefixes in recorded metadata are represented as `$HOME`; the remaining recorded path is preserved. Three Python launcher scripts resolve the original shared-lock path through `pathlib.Path.home()` instead of embedding a personal username. These packaging changes do not change the measured engine adapter, timer boundaries or measurement values. No new benchmark was run for publication.

The original `outputs/` layout is retained so fixture generation, verification and launch commands continue to resolve the same relative paths. The root README documents the required working directory, shared-lock configuration, platform pin and creation of the ignored `work/` directory.

Only synthetic fixture/code and benchmark results/metadata are included. Engine checkouts, binaries, dependency caches, live databases, generated account keys and temporary stores are excluded. This publication does not claim measurements of the Anytype application or the official server stack.
