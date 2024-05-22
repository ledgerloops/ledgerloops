/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync, writeFileSync } from 'node:fs';
import { BatchedNetworkSimulator, Saiga } from './main.ts';

const TESTNET_CSV = 'testnet-10.csv';
const SNAPSHOT = './post-init.json';

export async function init(): Promise<void> {
  const nodes: { [index: string]: Saiga } = {};
  const networkSimulator = new BatchedNetworkSimulator();
  console.log("Network simulator initialized.");
  const data = readFileSync(TESTNET_CSV, 'utf8')
  const lines = data.split('\n').map(line => {
    const [ from, to ] = line.split(' ')
    return { from, to }
  }).filter(line => line.from !== 'from' && line.from !== '');
  await networkSimulator.init(lines.map(line => `${line.from} ${line.to}`));
  lines.forEach(async line => {
      if (typeof nodes[line.from] === 'undefined') {
      // console.log("Adding node", line.from);
      nodes[line.from] = new Saiga(line.from);
      networkSimulator.addNode(line.from, nodes[line.from]);
    }
    if (typeof nodes[line.to] === 'undefined') {
      // console.log("Adding node", line.to);
      nodes[line.to] = new Saiga(line.to);
      networkSimulator.addNode(line.to, nodes[line.to]);
    }
    // console.log("Meeting", JSON.stringify(line.from), JSON.stringify(line.to));
    await nodes[line.from].meet(line.to);
  });
  writeFileSync(SNAPSHOT, JSON.stringify(networkSimulator.toSnapshot(), null, 2) + '\n');
}