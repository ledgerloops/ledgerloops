export { genRanHex } from "./genRanHex.ts";

export class Entry {
  sender: string;
  receiver: string;
  message: string;
  event: string;
  constructor(sender: string, receiver: string, message: string, event: string) {
    this.sender = sender;
    this.receiver = receiver;
    this.message = message;
    this.event = event;
  }
  describePath(): string {
    if (this.event === 'sent') {
      return `[${this.sender}]->[${this.receiver}]`;
    } else {
      return `[${this.sender}]>-[${this.receiver}]`;
    }
  }
}
function createPreamble(): string {
  return `@startuml messages\n`;
}
function createLine(entry: Entry): string {
  const colors: { [index: string]: string } = {
    'probe': 'blue',
    'trace': 'green',
    'meet': 'orange',
    'loop': 'red',
    'have-probes': 'purple',
    'okay-to-send-probes': 'purple',
  };
  if (entry.sender === '---') {
    return '';
  }
  if (entry.event !== 'sent') {
    return '';
  }
  if ((entry.message === 'have-probes') || (entry.message === 'okay-to-send-probes')) {
    return '';
  }
  const parts = entry.message.split(' ');
  if (parts.length < 2) {
    return '';
  }
  // if ((parts[0] !== 'meet') && (parts[1] !== 'genRanHex2')) {
  //   return '';
  // }
  const color = colors[entry.message.toString().split(' ')[0]] || 'black';
  return `${entry.sender} -[#${color}]-> ${entry.receiver}: ${entry.message}\n`;
}
function createEpilogue(): string {
  return '@enduml';
}
export function createPlantUml(log: Entry[]): string {
  return createPreamble() + log.map(line => createLine(line)).join('') + createEpilogue();
}