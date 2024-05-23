
import { setTrust } from "./cmd.ts";
import { init } from './init.ts';
import { sim } from './sim.ts';

export async function cli(): Promise<void> {
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
    case 'set-trust':
      await setTrust(Deno.args[1], Deno.args[2], parseFloat(Deno.args[3]), Deno.args[4]);
      return;
    case 'set-balance':
      console.log("set-balance", Deno.args[1], Deno.args[2], Deno.args[3], Deno.args[4]);
      return;
    default:
      console.log("Usage: npx ledgerloops command...");
  }
}
