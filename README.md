# LedgerLoops

This repository contains a miminal LedgerLoops node that implements DLD, greedy lift negotiation, and cooperative lift resolution.

## What is it
LedgerLoops is the name of a project, of a protocol developed in that project, and of a piece of software that acts as a reference
implementation of that protocol. This repository contains the piece of software. It is developed in TypeScript on Deno, and published
as open source through GitHub, through npm, and upon request through other channels.

## What does it do
Read more about the project's history and context on [ledgerloops.com](https://ledgerloops.com/).
This software is a work in progress. So far it only supports interactions between local nodes.

### Model
Agents are identified by a string (e.g. "alice").
Each agent can trust and lend to any other agent, over a trustline.
Currently, [CHIPs](https://chipcentral.net/) are the only supported unit of value for these trustlines.

Bilateral netting is implicit; this means that if Alice lends 10 CHIPs to Bob and Bob lends 3 CHIPs to Alice,
those 3 CHIPs are effectively paying off the loan of 10, so the new situation is that Alice is lending 10-3=7 CHIPs to Bob.

Lending is limited by trust, so if Alice trusts Bob for 25 CHIPs, she will not be able to lend him 30 CHIPs, since 30 < 25.

The name of a trustline is formed by the two agent names alphabetically with a hyphen inbetween. So the trustline between
Alice and Bob is always called "Alice-Bob", and never "Bob-Alice".

The following four statements are equivalent:
* Alice is lending 7 CHIPs to Bob
* Alice's balance on the Alice-Bob trustline is 7 CHIPs
* Bob is lending -7 CHIPs to Alice
* Bob's balance on the Alice-Bob trustline is -7 CHIPs

### Strategy
In the current implementation, agents will not attempt to make a profit on a lift.
Each agent will participate in a
[lift](https://michielbdejong.com/blog/32.html) if it brings their sum of absolute balances closer to zero,
as long as balance doesn't exceed trust.
So if Alice owes 15 CHIPs to Charlie but is owed 10 CHIPs by Bob, then if a lift is proposed that would
reduce her debt to Charlie by 12 CHIPs, while changing her credit with Bob of 10 CHIPs into a debt of 2 CHIPs,
provided she trusts Bob for at least those 2 CHIPs, she will calculate that:
* Current sum of absolute balances: abs(-15) + abs(10) = 25.
* Sum of absolute balances after the lift: abs(-3) + abs(-2) = 5

So since 5 < 25, provided she trusts Bob for at least those 2 CHIPs, her answer to this proposed lift will be yes.

### commands
* `set-trust <from> <to> <amount> CHIP`: Set the amount (in [CHIPs](https://chipcentral.net/)) agent `<from>` is willing to lend to agent `<to>`
* `set-balance <from> <to> <amount> CHIP`: Set the amount agent `<from>` is currently lending to `<to>`.

Agents will then automatically start sending message to each other to achieve collaborative netting.
The commands `init` and `sim` are deprecated.

## Running
### Using npx
```
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
