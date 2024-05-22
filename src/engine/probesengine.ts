import { genRanHex } from "../genRanHex.ts";
import { EventEmitter } from 'node:events';

export enum HandRaisingStatus {
  Listening,
  Waiting,
  Talking,
}

export class Friend {
  public handRaisingStatus: HandRaisingStatus;

  constructor(handRaisingStatus: HandRaisingStatus) {
    this.handRaisingStatus = handRaisingStatus;
  }
}

export class Probe {
  private probeId: string;
  private from: string[];
  private to: string[];
  private homeMinted: boolean;

  constructor (probeId: string, from: string[], to: string[], homeMinted: boolean) {
    this.probeId = probeId;
    this.from = from;
    this.to = to;
    this.homeMinted = homeMinted;
  }
  getProbeId(): string {
    return this.probeId;
  }
  getFrom(): string[] {
    return this.from;
  }
  getTo(): string[] {
    return this.to;
  }
  isHomeMinted(): boolean {
    return this.homeMinted;
  }
  recordIncoming(from: string): void {
    this.from.push(from);
  }
  recordOutgoing(to: string): void {
    this.to.push(to);
  }
  isVirginFor(friend: string): boolean {
    return !this.from.includes(friend) && !this.to.includes(friend);
  }
  toObject(): {
    probeId: string,
    from: string[],
    to: string[],
    homeMinted: boolean,
   } {
    return {
      probeId: this.probeId,
      from: this.from,
      to: this.to,
      homeMinted: this.homeMinted,
    };
  }
}

export class ProbesEngine extends EventEmitter {
  protected name: string;
  private probes: {
    [id: string]: Probe
  } = {};
  protected friends: {
    [name: string]: Friend
   }  = {};
  private probesToOffer: {
    [friend: string] : string[]
  } = {};
  constructor(name: string) {
    super();
    this.name = name;
  }
  toSnapshot(): {
    probes: {
      [id: string]: Probe
    },
    friends: {
      [name: string]: {
        handRaisingStatus: HandRaisingStatus,
      }
    }
  } {
    return {
      probes: this.probes,
      friends: this.friends,
    };
  }
  fromSnapshot(snapshot: {
    probes: {
      [id: string]: Probe
    },
    friends: {
      [name: string]: {
        handRaisingStatus: HandRaisingStatus,
      }
    }
  }) {
    this.probes = snapshot.probes;
    this.friends = snapshot.friends;
  }
  get(id: string): Probe | undefined {
    return this.probes[id];
  }
  ensure(id: string, homeMinted: boolean): Probe {
    if (typeof this.probes[id] === 'undefined') {
      this.probes[id] = new Probe(id, [], [], homeMinted);
    }
    return this.probes[id];
  }
  getKeys(): string[] {
    return Object.keys(this.probes);
  }

  // Postpone sending of probes until we have received the okay-to-send-probes message
  protected raiseHand(to: string): void {
    this.friends[to].handRaisingStatus = HandRaisingStatus.Waiting;
    this.emit('debug', `${this.name} raises hand to ${to}`);
    this.emit('message', to, 'have-probes');
  }

  public handleHaveProbesMessage(from: string): void {
    this.friends[from].handRaisingStatus = HandRaisingStatus.Listening;
    this.emit('message', from, 'okay-to-send-probes');
  }
  protected flushProbesQueue(friend: string): void {
    if (typeof this.probesToOffer[friend] !== 'undefined') {
      this.probesToOffer[friend].forEach(probeId => {
        const probe = this.get(probeId);
        if (typeof probe === 'undefined') {
          throw new Error(`Probe ${probeId} not found`);
        }
        if (probe.isVirginFor(friend)) {
          this.emit('debug', `QUEUEING PROBE ${probe.getProbeId()} TO ${friend} [3/4]`);
          probe.recordOutgoing(friend);
          const message = `probe ${probe.getProbeId()}`;
          this.emit('message', friend, message);
        }
      });
    }
  }
  public handleOkayToSendProbesMessage(friend: string): void {
    this.emit('debug', `${this.name} receives okay-to-send-probes from ${friend}`);
    this.friends[friend].handRaisingStatus = HandRaisingStatus.Talking;
    this.flushProbesQueue(friend);
  }
  protected tryToSendProbes(friend: string): void {
    if (this.friends[friend].handRaisingStatus === HandRaisingStatus.Talking) {
      this.emit('debug', `${this.name} is talking to ${friend}`);
      this.flushProbesQueue(friend);
    } else if (this.friends[friend].handRaisingStatus === HandRaisingStatus.Listening) {
      this.emit('debug', `${this.name} starts waiting to talk to ${friend}`);
      this.raiseHand(friend);
    }
  }

  protected queueProbe(friend: string, probeId: string, homeMinted: boolean): void {
    this.ensure(probeId, homeMinted);
    this.probesToOffer[friend] = this.probesToOffer[friend] || [];
    this.probesToOffer[friend].push(probeId);
    this.tryToSendProbes(friend);
  }
  public queueAllFloodProbes(other: string): void {
    this.emit('debug', `QUEUEING ALL FLOOD PROBES TO ${other}`);
    this.getKeys().forEach((probeId) => {
      this.emit('debug', `QUEUEING PROBE ${probeId} TO ${other}`);
      // setting homeMinted to false but we don't expect it to matter since this probe already exists
      this.queueProbe(other, probeId, false);
    });
  }
  protected queueFloodProbeToAll(probeId: string, homeMinted: boolean): void {
    Object.keys(this.friends).forEach(friend => {
      this.queueProbe(friend, probeId, homeMinted);
    });
  }
  protected createFloodProbe(): void {
    this.emit('debug', `creating flood probe`);
    return this.queueFloodProbeToAll(genRanHex(8), true);
  }
  public addFriend(other: string, weInitiate: boolean, createFloodProbe: boolean): void {
    this.friends[other] = new Friend(weInitiate ? HandRaisingStatus.Talking : HandRaisingStatus.Listening);

    this.queueAllFloodProbes(other);
    if (createFloodProbe) {
      this.emit('debug', `and create a new flood probe for other friends than ${other} [3/4]`);
      this.createFloodProbe();      
    }
  }
  public handleProbeMessage(sender: string, message: string): void {
    // console.log('handleProbeMessage', sender, message);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [ _messageType, probeId ] = message.split(' ');
    let probe: Probe | undefined = this.get(probeId);
    if (typeof probe === 'undefined') {
      this.emit('debug', `INCOMING PROBE ${probeId} IS NEW TO US, FLOOD IT FORWARD`);
      probe = this.ensure(probeId, false);
      probe.recordIncoming(sender);
      this.queueFloodProbeToAll(probeId, false);
    } else {
      this.emit('debug', `INCOMING PROBE ${probeId} IS KNOWN TO US`);
      if (probe.isVirginFor(sender)) {
        // Record this *after* testing it:
        probe.recordIncoming(sender);
        this.emit('debug', `PROBE ${probeId} ALREADY KNOWN TO US, VIRGIN FOR ${sender}!`);
        if (probe.isHomeMinted()) {
          this.emit('probe-loopback', probeId, 'root', probe.getFrom(), probe.getTo());
        } else {
          if (probe.getTo().length > 0) {
            this.emit('probe-loopback', probeId, 'internal', probe.getFrom(), probe.getTo());
          } else {
            this.emit('probe-loopback', probeId, 'leaf', probe.getFrom(), probe.getTo());
          }
        }
      } else {
        this.emit('debug', `PROBE ${probeId} ALREADY KNOWN TO US, BUT NOT VIRGIN FOR ${sender}!`);
      }
    }
  }
}
  