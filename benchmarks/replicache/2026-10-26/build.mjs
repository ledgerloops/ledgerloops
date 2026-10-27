import {build} from 'esbuild';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const work=process.env.BENCHMARK_WORK_DIR ? path.resolve(process.env.BENCHMARK_WORK_DIR) : path.join(here,'.work');
await build({entryPoints:[path.join(here,'browser.js')],bundle:true,format:'esm',
  outfile:path.join(work,'receiver.js'),define:{'process.env.NODE_ENV':JSON.stringify('production')}});
