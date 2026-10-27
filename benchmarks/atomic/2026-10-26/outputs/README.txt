Run from this task directory:

python3 outputs/generate_fixture.py outputs/fixture
python3 outputs/with_measurement_lock.py python3 outputs/run.py
python3 outputs/summarize.py outputs/model-h-20261026T063214Z

run.py copies the external harness into a dedicated /private/tmp runtime and
builds with isolated Cargo home, target and build paths, cargo --locked, -j 4,
release opt-level 2. It copies only library source from the authorized clean
checkout at the exact required pin; absent that checkout, it clones the public
repository and checks out the pin. It never reads existing data or keys.

The saved Cargo manifest resolves the engine under work/atomic-server/lib for
manual use; run.py rewrites only its runtime copy to the isolated pinned source.
The library files used in this run were individually verified against all 180
tracked lib blobs at the pin; see source-provenance.json. No upstream code was
modified. The source declares Rust 1.98.1; this external harness used the
available Rust 1.99.1, recorded in environment.json.

Each invocation creates a new run directory and 13 fresh receiver files, without
reusing previous stores. Keep the shared lock for builds/imports/runs. Temporary
identities are newly generated per prepared source; never supply personal keys.
run.py exports only synthetic JSON results/configs and a protocol-count log.
Its temporary-owner.secret stays in /private/tmp and should be deleted after
completion (the completed run's copy has already been deleted).

Results summarize the completed 20261026T063214Z series. A later queued run was
canceled before acquiring the lock; no second transfer series was executed.
Raw results are untouched. The 10 measured runs are 4–13, after warmups 1–3.

Source references:
https://github.com/ledgerloops/ledgerloops/issues/41
https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/examples/syncd_bulk_benchmark.rs
https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/sync/engine.rs
https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/sync/protocol.rs
https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/sync/peer.rs
https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/db/redb_store.rs
https://github.com/ontola/atomic-server/blob/396f0da075bd514e2c46b2fa33a575b35c14b2a6/lib/src/envelopes.rs
