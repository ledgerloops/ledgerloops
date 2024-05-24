import EventEmitter from "node:events";
import { genRanHex } from "../genRanHex.ts";
import { createHmac } from "node:crypto";

function sha256(secret: string): string {
  return createHmac('sha256', secret).digest('hex');
}

export class GiraffeLoopsEngine extends EventEmitter {
  profit: number;
  loops: string[];
  lifts: {
    [hash: string]: {
      loop: string,
      legId: string,
      secret?: string,
      incomingAmount?: number,
      outgoingAmount: number
    }
  }
  constructor() {
    super();
    this.loops = [];
    this.lifts = {};
    this.profit = 0;
  }
  toSnapshot(): { loops: string[], lifts: { [hash: string]: { loop: string, legId: string, secret?: string, incomingAmount?: number, outgoingAmount: number } }, profit: number } {
    return {
      loops: this.loops,
      lifts: this.lifts,
      profit: this.profit,
    };
  }
  fromSnapshot(snapshot: { loops: string[], lifts: { [hash: string]: { loop: string, legId: string, secret?: string, incomingAmount?: number, outgoingAmount: number } }, profit: number }) {
    this.loops = snapshot.loops;
    this.lifts = snapshot.lifts;
    this.profit = snapshot.profit;
  }
  setProfit(profit: number): void {
    this.profit = profit;
  }
  makeProfit(incomingAmount: number): number {
    return incomingAmount * (1 - this.profit);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  handleLoopFound(probeId: string, traceId: string, legId: string, outgoing: { name: string, maxBalance: number, exchangeRate: number }, incoming: { name: string, maxBalance: number, exchangeRate: number }): void {
    this.loops.push(`${probeId} ${traceId}`);
    this.emit('debug', `${probeId} ${traceId} ${legId} ${JSON.stringify(outgoing)} ${JSON.stringify(incoming)}`);
    const secret = genRanHex(32);
    const hash = sha256(secret);
    this.emit('debug', `secret is ${secret} and hash is ${hash}`);

    // const hash: string = SHA256(secret).toString();
    this.emit('message', outgoing.name, `propose ${probeId} ${traceId} ${legId} ${hash} 1`);  
    this.lifts[hash] = {
      loop: `${probeId} ${traceId}`,
      legId,
      secret,
      outgoingAmount: 1,
    };
  }
  handleProposeMessage(from: string, message: string, proposer: { name: string, maxBalance: number, exchangeRate: number }, committer: { name: string, maxBalance: number, exchangeRate: number }): void {
    this.emit('debug', `${from} ${message} ${JSON.stringify(committer)} ${JSON.stringify(proposer)}`);
    const [messageType, probeId, traceId, legId, hash, amount] = message.split(' ');
    if (messageType !== 'propose') {
      this.emit('debug', `expected propose message but got ${messageType}`);
    }
    if (typeof this.lifts[hash] !== 'undefined') {
      this.lifts[hash].incomingAmount = parseFloat(amount);
      this.emit('debug', `initiator decides on lift: always yes`);
      this.emit('message', proposer.name, `commit ${probeId} ${traceId} ${legId} ${hash} ${this.lifts[hash].incomingAmount} ${this.lifts[hash].secret}`);
    } else {
      const incomingAmount = parseFloat(amount);
      const outgoingAmount = this.makeProfit(incomingAmount * proposer.exchangeRate / committer.exchangeRate);
      this.lifts[hash] = {
        loop: `${probeId} ${traceId}`,
        legId,
        incomingAmount,
        outgoingAmount,
      }
      this.emit('debug', `forwarding propose ${JSON.stringify(this.lifts[hash])}`);
      this.emit('message', committer.name, `propose ${probeId} ${traceId} ${legId} ${hash} ${outgoingAmount}`);
    }
    // this.loops.push(`${probeId} ${traceId}`);
  }
  handleCommitMessage(from: string, message: string, committer: { name: string, maxBalance: number, exchangeRate: number }, proposer: { name: string, maxBalance: number, exchangeRate: number }): void {
    this.emit('debug', `${from} ${message} ${JSON.stringify(committer)} ${JSON.stringify(proposer)}`);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [messageType, probeId, traceId, legId, hash, amount, secret] = message.split(' ');
    if (messageType !== 'commit') {
      this.emit('debug', `expected commit message but got ${messageType}`);
      return;
    }
    if (typeof this.lifts[hash] === 'undefined') {
      this.emit('debug', `commit message for unknown hash ${hash}`);
      return;
    }
    this.emit('debug', `${message} is about ${JSON.stringify(this.lifts[hash])}`);
    if (amount !== this.lifts[hash].outgoingAmount.toString()) {
      this.emit('debug', `commit message for hash ${hash} with unexpected amount ${amount} != ${this.lifts[hash].outgoingAmount}`);
      return;
    }
    if (hash !== sha256(secret)) {
      this.emit('debug', `commit message for hash ${hash} with unexpected secret ${secret}`);
      return;
    }
    if (typeof this.lifts[hash].secret !== 'undefined') {
      // we are not the initiator
      this.emit('debug', 'lift was successfully completed');
    } else {
      this.lifts[hash].secret = secret;
      this.emit('debug', `forwarding commit ${JSON.stringify(this.lifts[hash])}`);
      this.emit('message', proposer.name, `commit ${probeId} ${traceId} ${legId} ${hash} ${this.lifts[hash].incomingAmount} ${this.lifts[hash].secret}`);
    }
  }
  getLoops(): string[] {
    return this.loops;
  }
}

export class SaigaLoopsEngine extends GiraffeLoopsEngine {
  constructor() {
    super();
  }
  makeProfit(incomingAmount: number): number {
    return incomingAmount;
  }
}
