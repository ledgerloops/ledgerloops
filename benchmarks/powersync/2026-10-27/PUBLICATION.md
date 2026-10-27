# Publication copy

Measurements were completed on 2026-10-27 for [ledgerloops/ledgerloops#42](https://github.com/ledgerloops/ledgerloops/issues/42) and published at the user’s request.

Only the completed primary run is published here. The earlier 2026-10-26 exploratory run is excluded: interleaving updates grew sender history between initial repetitions, and its decoder did not account for compression. Interrupted and failed startup attempts contribute no timing samples.

Recorded home-directory prefixes are represented as `$HOME` in the public JSON. Other storage paths, numerical measurements, source fixture hashes and correctness evidence are preserved. The original local result artifacts retain exact paths. No dependency tree, PostgreSQL/SQLite store, private JWT signing key, personal credential or personal record is included.

The source uses the current home directory or `BENCH_LOCK_PATH` for coordination, rather than embedding a personal username. Synthetic database passwords are public test constants. The matching engine service source is unmodified.
