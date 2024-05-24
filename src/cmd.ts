/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync, writeFileSync } from 'node:fs';
import { BatchedNetworkSimulator } from './main.ts';

const FILE = './snapshot.json';
const NUM_ROUNDS = 100000;

export function before(): BatchedNetworkSimulator {
  const networkSimulator = new BatchedNetworkSimulator();
  try {
    const snapshot = readFileSync(FILE, 'utf8');
    networkSimulator.fromSnapshot(JSON.parse(snapshot));
  } catch (error) {
    console.log("Error parsing snapshot", error);
  }
  return networkSimulator;
}

export function after(networkSimulator: BatchedNetworkSimulator): void {
  let counter = 0;
  let flushReport;
  do {
    flushReport = networkSimulator.flush();
  } while ((flushReport.length > 0) && (counter++ < NUM_ROUNDS));

  writeFileSync(FILE, JSON.stringify(networkSimulator.toSnapshot(), null, 2) + '\n');
}

export function setTrust(from: string, to: string, amount: number, unit: string) {
  if (unit !== 'XCH') {
    throw new Error("Only XCH units supported");
  }
  const networkSimulator = before();
  networkSimulator.setTrust(from, to, amount);
  after(networkSimulator);
}
export function setBalance(from: string, to: string, amount: number, unit: string) {
  const networkSimulator = before();
  if (unit !== 'XCH') {
    throw new Error("Only XCH units supported");
  }
  networkSimulator.setBalance(from, to, amount);
  after(networkSimulator);
}

export function getBalances(agent: string) {
  const networkSimulator = before();
  console.log(networkSimulator.getBalances(agent));
}