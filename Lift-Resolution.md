# Lift Resolution

## Terminology
A "trustline" is a relationship between agents where one or both are willing to give out a loan to the other agent.
A "loan" is when a trustline between two agents has a non-zero balance.
To the agent with positive balance, the loan is a credit.
To the agent with negative balance, the loan is a debt.
The trust graph is the graph formed by the trustlines
The loan graph is the graph formed by the loans.
It's possible to change the loan graph without changing the trust graph, and vice versa.

## Problem statement
Imagine a number of actors who have an opportunity to create, change, and/or settle loans between them, such that each agent is individually better off than before.
This means that each actor who becomes more endebted to one neighbour, also becomes less endebted to another, so that the sum of changes to the loan graph necessarily
forms a cyclic structure. How can the agents agree to either execute the changes or not? There are a number of variations on this problem statement, that call for
different solution mechanisms.

## Timeouts
In general, there is a moment when the details of a particular Lift Resolution proposal are first communicated.
From this moment on, participating agents will likely have to earmark some resources in case the proposal is executed, and these resource will be tied up and not
usable for other opportunities until the  proposal is either executed or rejected.
To give each agent some guaranteed limits on the time they are locking these resources up for, many existing algorithms use timeouts: a pre-agreed maximum timestamp
after which either the lift was successful, or it was cancelled.

Ripple Classic and Interledger use staggered timeouts.
MyCHIPs uses a refereed timeout.

## All-or-Nothing execution
Protocols that use staggered timeouts introduce a connector risk, where each agent runs the risk that their outgoing commitments are executed, but they don't have
enough time to get their incoming commitments executed.

## Ledger backing
Protocols like Bitcoin Lightning and Trustlines Network use contracts that are backed by global ledgers in different ways.
Bitcoin Lightning is made up of payment channels, where peers don't actually need to trust each other at all, they just each need to stake into a common pool,
and if one of the two misbehaves, the other can <a href="https://docs.lightning.engineering/the-lightning-network/payment-channels/lifecycle-of-a-payment-channel">force close</a> the channel between them.

In <a href="https://trustlines.network/">Trustlines Network</a>, a smart contract <a href-"https://docs.trustlines.network/resources/wp_content/how_trustlines_works/#43-smart-contract-system">is used</a> to ensure that multi-hop payments are either executed entirely or not at all, and that this happens within certain time limits.

## Arbitrary Cyclic Structure
 To simplify analysis, and because some algorithms only support loops and not arbitrary cyclic structures, we decompose the cyclic structure into individual loops.

## Unit of Value
In systems where some participating agents may have more information than others about the proposed lift, having
multiple units of value can open up ways for agents to hide from the others how much value they are getting out of the lift,
thereby making it hard to know if some participants are taking more than their fair share of the pie.
Imposing a unit of value, like MyCHIPs does, helps to mitigate this.
A strong rule to impose is that not only lifts are denoted in a globally understood unit, but also all trustline balances and loan amounts.

## Use of a Currency
What may seem like a subtlety but is actually a hugely important difference in Lift Resolution mechanism design is whether, apart from a common unit of value,
a common currency is also used between agents.

When a common currency is used, the global stash of this currency (whether interpreted as credit or as asset) can be modeled as an additional node in the trust graph and loan graph. This node can then sit in the middle of each lift resolution, splitting it up into smaller triangles. The downside is that this introduces a currency risk for
each participant. Lift Resolution with Currency is the default mechanism of the world's current payments system, so it's important but also well understood already,
and in a way it defines the system we want to replace, so we will study it relatively little here.

## Communication
In some statements of the Lift Resolution problem, like the one used for <a href="https://cofi.informal.systems/FAQ.html">MTCS</a>, there is a central authority that has
a bird's eye view of the network, and that each agent trusts. This is not the same as a currency, but it's still a central component. This central component is especially valuable for efficient loop detection ([using a Max Flow algorithm](https://github.com/ledgerloops/strategy-pit/issues/9) to remove non-cyclic structure from the graph).

MyCHIPs uses a referee node that each participating agent communicates with and trusts, and also each agent trusts that each other agent will obey the referee.
MyCHIPs are also working on a version of their protocol where each agent acts as a referee, but this still requires all participating agents to communicate with each other.

LedgerLoops and Interledger assume that agents only communicate with their direct neighbours.

## Act on loan graph or on trust graph
MTCS assumes the goal is to reduce debt (reduce the amount of deployed capital). Maybe not the global sum of it, but at least the sum of it for individual agents.
But especially when agents are allowed to make a profit from providing liquidity or providing loans ([FIXME](https://github.com/ledgerloops/strategy-pit/issues/28)),
they might want to participate in a lift even if it doesn't reduce their debt sum. It may even increase it, or move it to a place where the debt is less risky to them.

Also, the cost function of a debt might be non-linear. For instance, if 100 people each owe me 1 euro, I could prefer to aggregate those tiny debts into one 100 euro debt, and remove the other 99 debts, because it will be less hassle for me to administer.

On the other hand, if one person owes me 1000 euros, I might feel the risk is too high and I may not want to put all my eggs in one basket, so I might prefer to spread
that debt into ten 100-euro debts.

The Giraffe strategy in LedgerLoops Strategy Pit uses exchange rates between neighbours, so they have an ordered list of which debt they prefer to maximise/minimize, but they also want to make a 1% profit on each lift they participate in, so there is some inertia there.

All these consideration might cause an agent to choose to participate in a lift or not. Knowledge of these motivations will allow loop detection and lift resolution, but especially also lift negotiation, to be optimised a bit - although in the end, it will be down to game theory how agents negotiate and which loops they participate in and
which not. For Lift Resolution, these motivations are out of scope. Lift Resolution starts after a propose division of the profit pie is proposed, and only deals with
the timely decision on whether to execute or not.