import EventEmitter from "node:events";
import { genRanHex } from "../genRanHex.ts";

export class TracesEngine extends EventEmitter {
  tracesCreated: { [probeId: string]: { [traceId: string]: { [sender: string]: string } } } = {};
  tracesForwarded: { [probeId: string]: { [traceId: string]: { [sender: string]: string } } } = {};
  toSnapshot(): { tracesCreated: object, tracesForwarded: object } {
    return {
      tracesCreated: this.tracesCreated,
      tracesForwarded: this.tracesForwarded,
    };
  }
  fromSnapshot(snapshot: { tracesCreated: object, tracesForwarded: object }) {
    this.tracesCreated = snapshot.tracesCreated as { [probeId: string]: { [traceId: string]: { [sender: string]: string } } };
    this.tracesForwarded = snapshot.tracesForwarded as { [probeId: string]: { [traceId: string]: { [sender: string]: string } } };
  }
  getLegsForwarded(probeId: string, traceId: string): { [to: string]: string } | undefined {
    return this.tracesForwarded[probeId]?.[traceId];
  }
  getLegsCreated(probeId: string, traceId: string): { [to: string]: string } | undefined {
    return this.tracesCreated[probeId]?.[traceId];
  }
  wasCreatedByUs(probeId: string, traceId: string, legId: string): string | undefined {
    const legs = this.getLegsCreated(probeId, traceId);
    if (typeof legs !== 'undefined') {
      return Object.keys(legs).find((to) => legs[to] === legId);
    }
    return undefined;
  }
  getOtherLeg(probeId: string, traceId: string, thisLegId: string): string | undefined {
    const legs = this.getLegsForwarded(probeId, traceId);
    this.emit('debug', `Looking for other leg ${probeId} ${traceId} ${thisLegId} in ${JSON.stringify(legs)}`);
    if (typeof legs === 'undefined') {
      return undefined;
    }
    return Object.keys(legs).find((to) => legs[to] !== thisLegId);
  }
  logTraceMessage(sender: string, probeId: string, traceId: string, legId: string): void {
    if (typeof this.tracesForwarded[probeId] === 'undefined') {
      this.tracesForwarded[probeId] = {};
    }
    if (typeof this.tracesForwarded[probeId][traceId] === 'undefined') {
      this.tracesForwarded[probeId][traceId] = {};
    }
    this.tracesForwarded[probeId][traceId][sender] = legId;
    this.emit('debug', `tracesForwarded now looks like this: ${JSON.stringify(this.tracesForwarded)}`)
  }
  forwardTraceMessage(probeId: string, traceId: string, legId: string, nextHops: string[]): void {
    nextHops.forEach((to) => {
      this.emit('debug', `[TracesEngine] sending message to ${to}: trace ${probeId} ${traceId} ${legId}`);
      this.logTraceMessage(to, probeId, traceId, legId);
      this.emit('message', to, `trace ${probeId} ${traceId} ${legId}`);
    });
  }
  seenThisTraceBefore(probeId: string, traceId: string, legId: string): boolean {
    const legs = this.getLegsForwarded(probeId, traceId);
    this.emit('debug', `checking if we have seenThisTraceBefore ${probeId} ${traceId} ${legId} in ${JSON.stringify(legs)}`);
    if (typeof legs === 'undefined') {
      return false;
    }
    return Object.values(legs).includes(legId);
  }
  handleTraceMessage(sender: string, message: string): void {
    this.emit('debug', `[TraceEngine] handling trace message from ${sender}: ${message}`);
    const [messageType, probeId, traceId, legId] = message.split(' ');
    if (messageType !== 'trace') {
      throw new Error(`expected trace message but got ${messageType}`);
    }
    const to = this.wasCreatedByUs(probeId, traceId, legId);
    if (to !== undefined) {
      this.emit('debug', `loop-found ${probeId} ${traceId} ${legId} ${to} ${sender}`);
      this.emit('loop-found', probeId, traceId, legId, to, sender);
      return;
    }
    if (this.seenThisTraceBefore(probeId, traceId, legId)) {
      this.emit('debug', `seen this trace before ${probeId} ${traceId} ${legId}`);
      return;
    }
    this.logTraceMessage(sender, probeId, traceId, legId);
    this.emit('lookup-probe', probeId, (probeFrom: string[], probeTo: string[]) => {
      if (probeFrom.includes(sender)) {
        this.emit('debug', `[TraceEngine] forwarding a probe-wise trace message from ${sender}: ${message}`);
        this.forwardTraceMessage(probeId, traceId, legId, probeTo);
      } else if (probeTo.includes(sender)) {
        this.emit('debug', `[TraceEngine] forwarding a counter-probe-wise trace message from ${sender}: ${message}`);
        const otherLeg = this.getOtherLeg(probeId, traceId, legId);
        this.emit('debug', `[TraceEngine] in the context of trace message from ${sender}: ${message}, we found these counter-probe-wise next hops: [${probeFrom.join(', ')}], and otherLeg ${otherLeg}`);
        if (typeof otherLeg === 'undefined') {  
          this.forwardTraceMessage(probeId, traceId, legId, probeFrom);
        } else {
          this.emit('debug', `[TracesEngine] found otherLeg ${otherLeg} for trace ${traceId} of probe ${probeId}`);
          if (otherLeg === sender) {
            this.emit('debug', `UNEXPECTED: Received two different legs from the same node`);
          }
          this.emit('message', otherLeg, `trace ${probeId} ${traceId} ${legId}`);
        }
      } else {
        this.emit('debug', `received trace message '${message}' from unexpected sender ${sender}`);
        // throw new Error(`received trace message '${message}' from unexpected sender ${sender}`);
      }
    });
  }

  handleProbeLoopback(probeId: string): void {
    this.emit('lookup-probe', probeId, (probeFrom: string[]) => {
      const traceId = genRanHex(8);
      const legs: { [index: string]: string } = {};
      probeFrom.forEach((from: string) => {
        const legId = genRanHex(8);
        legs[from] = legId;
        this.emit('message', from, `trace ${probeId} ${traceId} ${legId}`);
      });
      if (typeof this.tracesCreated[probeId] === 'undefined') {
        this.tracesCreated[probeId] = {};
      }
      this.tracesCreated[probeId][traceId] = legs;
    });
  }
  getOtherParty(firstParty: string, probeId: string, traceId: string, legId: string): string | undefined {
    const legsCreated = this.getLegsCreated(probeId, traceId);
    this.emit('debug', `Looking for a party in ${probeId} ${traceId} with ${legId} other than ${firstParty} in created: ${JSON.stringify(legsCreated)}`);
    if (typeof legsCreated !== 'undefined') {
      return Object.keys(legsCreated).find((to) => legsCreated[to] === legId && to !== firstParty);
    }
    const legsForwarded = this.getLegsForwarded(probeId, traceId);
    this.emit('debug', `Looking for a party in ${probeId} ${traceId} with ${legId} other than ${firstParty} in forwarded: ${JSON.stringify(legsForwarded)}`);
    if (typeof legsForwarded !== 'undefined') {
      return Object.keys(legsForwarded).find((to) => legsForwarded[to] === legId && to !== firstParty);
    }
    return undefined;
  }
}
  