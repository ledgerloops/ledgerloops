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
Currently, [CHIPs ("XCH")](https://chipcentral.net/) are the only supported unit of value for these trustlines.

Bilateral netting is implicit; this means that if Alice lends 10 XCH to Bob and Bob lends 3 XCH to Alice,
those 3 XCH are effectively paying off the loan of 10, so the new situation is that Alice is lending 10-3=7 XCH to Bob.

Lending is limited by trust, so if Alice trusts Bob for 25 XCH, she will not be able to lend him 30 XCH, since 30 < 25.

The name of a trustline is formed by the two agent names alphabetically with a hyphen inbetween. So the trustline between
Alice and Bob is always called "Alice-Bob", and never "Bob-Alice".

The following four statements are equivalent:
* Alice is lending 7 XCH to Bob
* Alice's balance on the Alice-Bob trustline is 7 XCH
* Bob is lending -7 XCH to Alice
* Bob's balance on the Alice-Bob trustline is -7 XCH

### Strategy
In the current implementation, agents will not attempt to make a profit on a lift.
Each agent will participate in a
[lift](https://michielbdejong.com/blog/32.html) if it brings their sum of absolute balances closer to zero,
as long as balance doesn't exceed trust.
So if Alice owes 15 XCH to Charlie but is owed 10 XCH by Bob, then if a lift is proposed that would
reduce her debt to Charlie by 12 XCH, while changing her credit with Bob of 10 XCH into a debt of 2 XCH,
provided she trusts Bob for at least those 2 XCH, she will calculate that:
* Current sum of absolute balances: abs(-15) + abs(10) = 25.
* Sum of absolute balances after the lift: abs(-3) + abs(-2) = 5

So since 5 < 25, provided she trusts Bob for at least those 2 XCH, her answer to this proposed lift will be yes.

### commands
* `set-trust <from> <to> <amount> XCH`: Set the amount (in [CHIPs/XCH](https://chipcentral.net/)) agent `<from>` is willing to lend to agent `<to>`
* `set-balance <from> <to> <amount> XCH`: Set the amount agent `<from>` is currently lending to `<to>`.
* `get-balances <agent>`: Prints the current balances of this agent.

Agents will then automatically start sending message to each other to achieve collaborative netting.
The commands `init` and `sim` are deprecated.

## Running
### Using npx
```
npx ledgerloops new
npx ledgerloops set-trust alice bob 10 XCH
npx ledgerloops set-trust bob charlie 10 XCH
npx ledgerloops set-trust charlie alice 10 XCH
npx ledgerloops set-balance alice bob 10 XCH
npx ledgerloops set-balance bob charlie 5 XCH
npx ledgerloops set-balance charlie alice 3 XCH
npx ledgerloops get-balances alice
npx ledgerloops get-balances bob
npx ledgerloops get-balances charlie
```
This should trigger a lift of 3 XCH, so that:
* Alice's balance will go from [10, -3] to [7, 0]
* Bob's balance will go from [-10, 5] to [-7, 2]
* Charlie's balance will go from [-5, 3] to [-2, 0]


### Using Deno
```
git clone https://github.com/ledgerloops/ledgerloops
cd ledgerloops
deno run -A ./src/run.ts get-balances alice
```
You can run the same commands here as through `npx`.

If you want to try out the [Earthstar](https://earthstar-project.org/) transport for messaging ([not working yet](https://github.com/ledgerloops/saiga/issues/1)!),
see [the Earthstar branch on the Saiga repo](https://github.com/ledgerloops/saiga/tree/earthstar).
