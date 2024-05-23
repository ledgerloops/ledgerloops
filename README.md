# LedgerLoops

This repository contains a miminal LedgerLoops node that implements DLD, greedy lift negotiation, and cooperative lift resolution.

## Running
### Using npx
```
npm install ledgerloops
npx ledgerloops init
npx ledgerloops sim
```

### Using Deno
```
git clone https://github.com/ledgerloops/ledgerloops
cd ledgerloops
deno run -A ./src/run.ts init
deno run -A ./src/run.ts sim
```

If you want to try out the [Earthstar](https://earthstar-project.org/) transport for messaging ([not working yet](https://github.com/ledgerloops/saiga/issues/1)!),
see [the Earthstar branch on the Saiga repo](https://github.com/ledgerloops/saiga/tree/earthstar).
