const fs = require('fs').promises
const Node = require('./node')
const SIM_LENGTH = 10000

function linesNeeded (simLength) {
  return Math.ceil((simLength) / 10)
}

function expectLinesNeeded (input, output) {
  const actual = linesNeeded(input)
  if (actual !== output) {
    throw new Error(`Expected linesNeeded(${input}) to equal ${output}, got ${actual}`)
  }
}
function testLinesNeeded () {
  expectLinesNeeded(0, 0)
  expectLinesNeeded(1, 1)
  expectLinesNeeded(10, 1)
  expectLinesNeeded(11, 2)
  expectLinesNeeded(12, 2)
  expectLinesNeeded(100, 10)
  expectLinesNeeded(1001, 101)
}

async function getLines () {
  const data = await fs.readFile('testnet.csv', 'utf8')
  const lines = data.split('\n').map(line => {
    const [ from, to, fromMaxBalance, fromExchangeRate, toMaxBalance, toExchangeRate ] = line.split(' ')
    return { from, to, fromMaxBalance, fromExchangeRate, toMaxBalance, toExchangeRate }
  }).filter(line => line.from !== 'from' && line.from !== '')
  console.log(`Need at least ${linesNeeded(SIM_LENGTH)} lines, got ${lines.length}`)
  if (lines.length < linesNeeded(SIM_LENGTH)) {
    throw new Error(`Not enough data!`)
  }
  return lines
}

const graph = {}
const inFlight = []

function createMsgCallback (id) {
  return function (to, msg) {
    console.log(`Message from ${id} to ${to} going into flight: ${msg}`)
    inFlight.push({ from: id, to, msg })
  }
}
function simMessages () {
  while (inFlight.length) {
    const { from, to, msg } = inFlight.shift()
    if (graph[to]) {
      graph[to].receiveMessage(from, msg)
    }
  }
}
function addLink ({ from, to, fromMaxBalance, fromExchangeRate, toMaxBalance, toExchangeRate }) {
  if (from === 'from' || from === '') {
    // CAVEAT - this influences the cadence of adding links
    return
  }
  if (!graph[from]) {
    graph[from] = new Node(from, createMsgCallback(from))
  }
  graph[from].addLink({
    peer: to,
    ourMinBalance: -parseInt(toMaxBalance),
    ourMaxBalance: parseInt(fromMaxBalance),
    ourExchangeRate: parseFloat(fromExchangeRate)
  })
  if (!graph[to]) {
    graph[to] = new Node(to, createMsgCallback(to))
  }
  graph[to].addLink({
    peer: from,
    ourMinBalance: -parseInt(fromMaxBalance),
    ourMaxBalance: parseInt(toMaxBalance),
    ourExchangeRate: parseFloat(toExchangeRate)
  })
}

console.log(graph)

async function run () {
  testLinesNeeded()
  const lines = await getLines()
  let simStep = 0
  while (simStep < SIM_LENGTH) {
    console.log(`Sim step ${simStep}, phase I: delivering messages`)
    simMessages()

    for (const id in graph) {
      graph[id].processMessages()
    }
    if (simStep % 10 === 0) {
      const line = lines[simStep / 10]
      console.log(`Sim step ${simStep}, phase II: adding link from ${line.from} to ${line.to}`)
      addLink(line)
    }
    console.log(`Sim step ${simStep} complete, delivering messages`)
    simMessages()
    simStep++
  }
//   console.log(graph)
}

// ...
run()
