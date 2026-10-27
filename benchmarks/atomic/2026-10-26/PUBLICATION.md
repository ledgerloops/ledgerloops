# Publication copy

Measurements were collected on 2026-10-26 and published at the user's request on 2026-10-27. Numerical results, fixture bytes, pinned dependencies, Rust adapter source and correctness evidence are unchanged. No additional timed transfer series was run for publication.

Recorded personal home-directory prefixes are represented as `$HOME`. The Python runner's optional source-checkout path and shared-lock path use `Path.home()` rather than a personal username. These path changes affect only replay configuration. The Markdown report and this README organize the existing evidence for the repository's `benchmarks/<engine>/<date>` layout.

Only synthetic fixture data, code, metadata and exported results are included. Temporary test secrets, database files, dependency caches and build products are excluded. Current local state files identifying the latest run/runtime are omitted so a replay creates its own fresh state.
