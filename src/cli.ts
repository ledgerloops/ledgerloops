
import { init } from './init.ts';
import { sim } from './sim.ts';

export function cli(): void {
  const cmd = Deno.args[0];
  switch (cmd) {
    case 'init':
      init().then(() => {
        console.log("Initialization complete.");
      }).catch((error) => {
        console.log("Initialization failed", error);
      });
      return;
    case 'sim':
      sim();
      return;
    default:
      console.log("Usage: npx ledgerloops init|run");
  }
}