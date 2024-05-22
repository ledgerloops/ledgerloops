# Decentralized Loop Detection (DLD)
Decentralized Loop Detection is an algorithm to help a network of collaborating nodes to detect loops.
This can be useful in cases where loops are undesired (such as routing) or desired (such as decentralized multilateral netting).
The DLD algorithm works on two phases: probes and traces. This version of the DLD algorithm is implemented in
the [Giraffe strategy](https://github.com/ledgerloops/strategy-pit/tree/main?tab=readme-ov-file#-giraffe) of this repository.

## Probes
Probes carry a high-entropy nonce and get forwarded from node to node, flooding the network until they cannot go any further.
### Meeting
When a new link is added to the network, between "first party" and "second party", the first party receives a "meet" event.
The first party sends a meet message to the second party and enters talking mode.
The second party receives the meet message and enters listening mode.

### Probe sending
Probes are sent with a semaphore, because if two probe messages with the same nonce pass in mid-air, it will be impossible for
either node to detect the loop. Therefore, only one of the two nodes involved in a link is in talking mode, and is allowed to send
probe messages. The other node is in listening or waiting mode.
If a node is in talking mode, it can send a probe message at any time.
If a node is in listening mode, it can queue a probe message, send a 'raise-hand-for-probes' message, and go into waiting mode.
The other node can respond to the 'raise-hand-for-probes' message by itself going into listening mode and sending back an
'okay-to-send-probes' message.
When the waiting nodes receives the 'okay-to-send-probes' message, it switches from waiting to listening modes and sends all probe
messages that it had queued.
It is up to each node, when they receive a 'raise-hand-for-probes' messages, whether they first finish sending all the probe messages
they were in the middle of sending, or whether they keep their own messages queued and let the other party go first.
For this semaphore mechanism to work, it's important that messages are never delivered in a different order than the order in which they
were sent ([causal ordering of messages](https://www.geeksforgeeks.org/causal-ordering-of-messages-in-distributed-system/)).

### Exchanging probes on meet
When a node meets a new neighbour, regardless of whether it is in first party or second party role, it will send that neighbour
all its known probes, observing the probe sending mechanism, and unless the other neighbour sends that one to them first.
Note that a probe may be queued for sending, but by the time the sending node goes into talking mode, that probe might already be received
from the other neighbour, so it's important to do the check at the actual time of sending and not at the time of queueing.

### Minting a new probe
In addition to this exchange of known probes, the first party node mints a new probe and sends that to all its neighbours including the new one,
observing the semaphore protocol for each
neighbour. This is because a change in network topology where a new link is introduced may introduce new loops, so this is a good time
to do a new probe.

Of course, any node could mint a new probe at any time, and the other nodes would just play along without knowing who minted it and why.
This means an attacker can flood the network and keep everyone busy with useless probes, so nodes will need some mitigation to keep
probe traffic volume within reason.

### Forwarding a probe
When a probe comes in from one neighbour, if the probe wasn't seen before, a node should always forward it to all its other neighbours.
This means each probe spreads exponentially across the entire network. This could lead to high probe traffic, but if the nonces are not
too long, then many probe messages can be compressed into a relatively manageable file size for a batch of many probes, and the delay
a node may build in before forwarding a batch of probes, will linearly decrease the bandwidth requirements.

### Detecting a loop
There are 4 ways a probe can loop back on itself: to the root, backward to an internal node, forward to an internal node,
or to a head. The loop back to the root (i.e. back to the node
where it was minted) is the simplest one. Black lines are link, red arrows are probe messages that play a part in the loop.
Probe messages that went in other directions and did not contribute to the loop are not displayed:

![loop-to-root](https://private-user-images.githubusercontent.com/408412/323499096-c3ffc1c5-d270-4f91-883b-6cdb49ab5d31.png?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3MTM1MjU5MDcsIm5iZiI6MTcxMzUyNTYwNywicGF0aCI6Ii80MDg0MTIvMzIzNDk5MDk2LWMzZmZjMWM1LWQyNzAtNGY5MS04ODNiLTZjZGI0OWFiNWQzMS5wbmc_WC1BbXotQWxnb3JpdGhtPUFXUzQtSE1BQy1TSEEyNTYmWC1BbXotQ3JlZGVudGlhbD1BS0lBVkNPRFlMU0E1M1BRSzRaQSUyRjIwMjQwNDE5JTJGdXMtZWFzdC0xJTJGczMlMkZhd3M0X3JlcXVlc3QmWC1BbXotRGF0ZT0yMDI0MDQxOVQxMTIwMDdaJlgtQW16LUV4cGlyZXM9MzAwJlgtQW16LVNpZ25hdHVyZT0yZTE0YTBkMzY4MzQwOTA0OWVhZGI1YzQzYzExMWYwYjgxZmE3NTJjZDcwMDcxOWFjZjZkMGM2NjRhMGZiNzVjJlgtQW16LVNpZ25lZEhlYWRlcnM9aG9zdCZhY3Rvcl9pZD0wJmtleV9pZD0wJnJlcG9faWQ9MCJ9.-kTHEd_LxbT2x3wv89NkF3g-COd_q8kz3Gl6fLrvnIQ)

When a node sees a probe come in that it has minted itself, it can immediately conclude that a loop was found, but in order to trace its path,
and to deal with other cases in which there may still be doubt, this algorithm uses Traces (see below) which do the final loop detection,
using the information from the Probe paths.

Another situation is if a trace is received twice, but was never sent out. We call this a loop-to-head:

![loop-to-head](https://github.com/ledgerloops/strategy-pit/assets/408412/71b3265e-b8db-41b4-abd8-8242cd35adc6)

If a node receives a probe a second time after already having forwarded it, then it is either a backward-internal loop:

![backward-internal](https://github.com/ledgerloops/strategy-pit/assets/408412/2ee178cb-5ccd-41b7-80f7-c12faeb9e382)

or a forward-internal loop:

![forward-internal](https://github.com/ledgerloops/strategy-pit/assets/408412/9f8f2f2c-4cb9-4868-b590-e0efee5368e5)

In all cases, if a known probe comes in, the node should trigger a trace for that probe, using the nonce from the probe as the `probeId`.

## Traces
Traces don't need a semaphore, and they are handled according to three rules: the minting rule, the forwarding rule, and the bouncing rule.
### Definitions
A Probe is identified by the nonce it carries, which we refer to as its `probeId`.

The neighbours from which a probe message with a given `probeId` was received are a node's `from`-neighbours for that probe.
The neighbours to which a probe message with a given `probeId` was sent are that node's `to`-neighbours for that probe.

A Trace message carries three nonces: `probeId`, `traceId` and `legId`. All messages that have the same three nonces together form  a Leg.
All messages that differ only in `legId` form a Trace. This way, a Leg pertains to a Trace, and a Trace in turn pertains to a Probe through
its `probeId`.
A Trace message that travels in the same direction as the corresponding Probe message, i.e. they are received from a `from`-neighbour of the
Probe they pertain to, and/or sent to a `to`-neighbour thereof, are probe-wise trace messages.
Trace messages that travel in the opposite direction are counter-probe-wise trace messages.

If a Trace is received from a `to`-neighbour of the corresponding Probe, then the "opposite" neighbours are the `from`-neighbours, and likewise,
if a Trace is received from a `from`-neighbour of the corresponding Probe, then the "opposite" neighbours are the `to`-neighbours.

### Minting rule
A node that receives a Probe whose nonce it has seen before should
mint one `traceId`, and one `legId` per `from`-neighbour, and send each `from`-neighbour a trace message with three nonces in it: the `probeId` nonce from
the probe, the `traceId` and the `legId`. If it sees one of these loop back to itself, then it can announce that a loop was detected.

### Forwarding rule
If a Trace with known `probeId` but unknown `traceId` and `legId` is received, remember it and forward it to all opposite neighbours for the Probe to which
the Trace pertains.

### Bouncing rule
If a Trace with known `probeId` and `traceId` but unknown `legId` is received, remember it and forward it to all other neighbours from which a Trace with that
`probeId` and `traceId`  was received. Note that this means the trace changes direction; if it arrived as a probe-wise trace message then it will continue
from here on as a counter-probe-wise trace message, and vice versa.


