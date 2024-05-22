/* eslint-disable @typescript-eslint/no-explicit-any */

import { init } from './init.ts';
import { run } from './run.ts';

function cli(): void {
  const cmd = Deno.args[0];
  switch (cmd) {
    case 'init':
      init().then(() => {
        console.log("Initialization complete.");
      }).catch((error) => {
        console.log("Initialization failed", error);
      });
      return;
    case 'run':
      run();
      return;
    default:
      console.log("Usage: npx ledgerloops init|run");
  }
}

// ...
cli();