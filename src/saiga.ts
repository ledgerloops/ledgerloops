import EventEmitter from "node:events";
import { NetworkNode } from "./simulator/networksimulator.ts";
import { getMessageType } from "./messages.ts";
import { HandRaisingStatus, Probe, ProbesEngine } from "./engine/probesengine.ts";
import { SaigaFriendsEngine } from "./engine/friendsengine.ts";
import { TracesEngine } from "./engine/tracesengine.ts";
import { SaigaLoopsEngine } from "./engine/loopsengine.ts";

export class Saiga extends EventEmitter implements NetworkNode {
  protected friendsEngine: SaigaFriendsEngine;
  protected probesEngine: ProbesEngine;
  protected tracesEngine: TracesEngine;
  protected loopsEngine: SaigaLoopsEngine;
  protected debugLog: string[] = [];
  protected name: string;

  constructor(name: string) {
    super();
    this.name = name;
    this.friendsEngine = new SaigaFriendsEngine(name);
    this.probesEngine = this.connectProbesEngine();
    this.tracesEngine = this.connectTracesEngine(this.probesEngine);
    this.loopsEngine = this.connectLoopsEngine(this.tracesEngine);
    this.loopsEngine.setProfit(0.01);
  }
  toSnapshot() {
    return {
      friends: this.friendsEngine.toSnapshot(),
      probes: this.probesEngine.toSnapshot(),
      traces: this.tracesEngine.toSnapshot(),
      loops: this.loopsEngine.toSnapshot(),
      debugLog: this.debugLog,
      name: this.name
    };
  }
  fromSnapshot(snapshot: { friends: object, probes: object, traces: object, loops: object, debugLog: string[], name: string }) {
    this.friendsEngine.fromSnapshot(snapshot.friends as { [name: string]: { name: string, balance: number, maxBalance: number, exchangeRate: number } });
    this.probesEngine.fromSnapshot(snapshot.probes as {
      probes: {
        [id: string]: Probe
      },
      friends: {
        [name: string]: {
          handRaisingStatus: HandRaisingStatus,
        }
      }
    });
    this.tracesEngine.fromSnapshot(snapshot.traces as { tracesCreated: object, tracesForwarded: object });
    this.loopsEngine.fromSnapshot(snapshot.loops as { loops: string[], lifts: { [hash: string]: { loop: string, legId: string, secret?: string, incomingAmount?: number, outgoingAmount: number } }, profit: number });
    this.debugLog = snapshot.debugLog;
    this.name = snapshot.name;
  }
  setTrust(to: string, amount: number): void {
    if (this.friendsEngine.getFriend(to) === undefined) {
      this.meet(to, true, amount);
    } else {  
      this.friendsEngine.setTrust(to, amount);
    }
  }
  setBalance(to: string, amount: number): void {
    this.friendsEngine.setBalance(to, amount);
    this.emit('message', to, `set-balance ${amount}`);
  }
  getBalances(): { [name: string]: number } {
    const balances: { [name: string]: number } = {};
    Object.keys(this.friendsEngine.getFriends()).forEach((name: string) => {
      const friend = this.friendsEngine.getFriend(name);
      if (friend !== undefined) {
        balances[name] = friend.balance;
      }
    });
    return balances;
  }
  protected connectProbesEngine(): ProbesEngine {
    const probesengine = new ProbesEngine(this.name);
    probesengine.on('message', (to: string, message: string) => {
      this.emit('message', to, message);
    });
    // probesengine.on('debug', (message: string) => {
    //   this.debugLog.push(message);
    // });
    return probesengine;
  }
  protected connectTracesEngine(probesengine: ProbesEngine): TracesEngine {
    const tracesEngine = new TracesEngine();
    probesengine.on('probe-loopback', (probeId: string): void => {
      tracesEngine.handleProbeLoopback(probeId);
    });
    // tracesengine.on('debug', (message: string) => {
    //   this.debugLog.push(message);
    // });
    tracesEngine.on('lookup-probe', (probeId: string, callback: (probeFrom: string[], probeTo: string[]) => void) => {
      this.debugLog.push(`[Node#lookup-probe] ${this.name} is looking up probe ${probeId}`);
      const probe = probesengine.get(probeId);
      if (typeof probe === 'undefined') {
        callback([], []);
      } else {
        callback(probe.getFrom(), probe.getTo());
      }
    });
    tracesEngine.on('debug', (message: string) => {
      this.debugLog.push(message);
    });
    tracesEngine.on('message', (to: string, message: string) => {
      this.debugLog.push(`[traceEngine.on-message] ${this.name} sends trace message to ${to}: ${message}`);
      this.emit('message', to, message);
    });
    return tracesEngine;
  }
  protected connectLoopsEngine(traceEngine: TracesEngine): SaigaLoopsEngine {
    const loopsEngine = new SaigaLoopsEngine();
    traceEngine.on('loop-found', (probeId: string, traceId: string, legId: string, outgoing: string, incoming: string) => {
      const outgoingFriend = this.friendsEngine.getFriend(outgoing);
      const incomingFriend = this.friendsEngine.getFriend(incoming);
      if (typeof outgoingFriend === 'undefined' || typeof incomingFriend === 'undefined') {
        return;
      }
      loopsEngine.handleLoopFound(probeId, traceId, legId, outgoingFriend, incomingFriend);
    });
    loopsEngine.on('debug', (message: string) => {
      this.debugLog.push(message);
    });
    loopsEngine.on('message', (to: string, message: string) => {
      this.debugLog.push(`[Node#sendTracMessage] ${this.name} sends loops message to ${to}: ${message}`);
      this.emit('message', to, message);
    });
    return loopsEngine;
  }
  protected handleLoopMessage(from: string, message: string): void {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [messageType, probeId, traceId, legId] = message.split(' ');
    const otherPartyName = this.tracesEngine.getOtherParty(from, probeId, traceId, legId);
    if (typeof otherPartyName === 'undefined') {
      this.debugLog.push(`other party not found for ${from} ${message}`);
      return;
    }
    const sender = this.friendsEngine.getFriend(from);
    const otherParty = this.friendsEngine.getFriend(otherPartyName);
    if (typeof sender === 'undefined' || typeof otherParty === 'undefined') {
      this.debugLog.push(`other party not found for ${from} ${message}`);
      return;
    }
    if (messageType === 'propose') {
      this.loopsEngine.handleProposeMessage(from, message, sender, otherParty);
    } else if (messageType === 'commit') {
      this.loopsEngine.handleCommitMessage(from, message, sender, otherParty);
    }
  }
  process(sender: string, message: string): void {
    this.debugLog.push(`[Node#receiveMessage] ${this.name} receives message from ${sender}`);
    // console.log(`${this.name} receives message from ${sender}`, message);
    switch(getMessageType(message)) {
      case `meet`:
        this.friendsEngine.addFriend(sender);
        this.debugLog.push(`MEET MESSAGE FROM ${sender}, queueing all flood probes`);
        return this.probesEngine.addFriend(sender, false, false);
      case `probe`: return this.probesEngine.handleProbeMessage(sender, message);
      case `trace`: return this.tracesEngine.handleTraceMessage(sender, message);
      case `propose`: return this.handleLoopMessage(sender, message);
      case `commit`: return this.handleLoopMessage(sender, message);
      case `have-probes`: return this.probesEngine.handleHaveProbesMessage(sender);
      case `okay-to-send-probes`: return this.probesEngine.handleOkayToSendProbesMessage(sender);
      case `set-balance`: return void this.friendsEngine.setBalance(sender, parseFloat(message.split(' ')[1]));
    }
  }
  meet(other: string, createProbe: boolean = true, maxBalance: number = 10.0): void {
    const newFriendship = this.friendsEngine.addFriend(other, maxBalance);
    if (!newFriendship) {
      return;
    }
    this.debugLog.push(`I meet ${other} [1/4]`);
    // this is safe to because it will just queue them for the next message round
    this.emit('message', other, 'meet');
    this.debugLog.push(`I queue ${other} all my flood probes [2/4]`);
    this.probesEngine.addFriend(other, true, createProbe);
    this.debugLog.push(`Done onMeet ${other} [4/4]`);
  }
  // initiateLift(traceId: string) {
  //   this.friendsEngine.
  // }
  getName(): string {
    return this.name;
  }
  getDebugLog(): string[] {
    return this.debugLog;
  }
  getFriends(): string[] {
    return Object.keys(this.friendsEngine.getFriends());
  }
  getLoops(): string[] {
    return this.loopsEngine.getLoops();
  }
}
