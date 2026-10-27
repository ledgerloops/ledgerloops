#!/usr/bin/env python3
"""Stage code and install exact lockfile outside Documents, then exec measurements."""
import pathlib, shutil, subprocess, os, sys, datetime, hashlib, json

source=pathlib.Path(__file__).resolve().parent
target=pathlib.Path('/private/tmp/sync-benchmark-jazz-20261026-runtime/harness')
target.mkdir(parents=True,exist_ok=True)
for p in source.iterdir():
    if p.is_file() and p.suffix in ['.mjs','.py','.json','.html','.txt']:
        shutil.copyfile(p,target/p.name)
# Regenerate exact synthetic bytes rather than reading a provider-stalled source file.
subprocess.run([sys.executable,str(target/'generate_fixture.py'),str(target/'fixture')],check=True,timeout=30)
# These task-owned dependencies are reproducible from the lockfile and are not deliverables.
if (source/'node_modules').exists():
    shutil.rmtree(source/'node_modules')
empty=target/'empty-npmrc';empty.write_text('registry=https://registry.npmjs.org/\n')
subprocess.run(['npm','ci','--prefix',str(target),'--cache','/private/tmp/sync-benchmark-jazz-20261026-runtime/npm-cache','--userconfig',str(empty),'--no-audit','--no-fund'],check=True,timeout=300)
runtime=pathlib.Path('/private/tmp/sync-benchmark-jazz-20261026-runtime')
executable=runtime/'browsers/chromium_headless_shell-1194/chrome-mac/headless_shell'
runtimes=os.environ.get('JAZZ_RUNTIMES','native,browser')
if 'browser' in runtimes and not executable.exists():
    archive=runtime/'chromium-headless-shell-mac-arm64-1194.zip'
    url='https://cdn.playwright.dev/dbazure/download/playwright/builds/chromium/1194/chromium-headless-shell-mac-arm64.zip'
    subprocess.run(['curl','-fsSL','--max-time','120',url,'-o',str(archive)],check=True,timeout=130)
    digest=hashlib.sha256(archive.read_bytes()).hexdigest()
    if digest!='c4c97caab34c16f9a2bb411da0e68505deacb35c86d70db63dc117381a5e6d60':
        raise RuntimeError('Pinned Chromium archive hash mismatch')
    destination=executable.parent.parent;destination.mkdir(parents=True,exist_ok=True)
    subprocess.run(['/usr/bin/unzip','-q','-o',str(archive),'-d',str(destination)],check=True,timeout=90)
    executable.chmod(executable.stat().st_mode|0o111)
name=os.environ.get('JAZZ_RUN_NAME',datetime.datetime.now(datetime.timezone.utc).isoformat().replace(':','-'))
environment=dict(os.environ,JAZZ_RUN_NAME=name,JAZZ_RUNTIMES=runtimes)
os.execvpe('node',['node',str(target/'run.mjs')],environment)
