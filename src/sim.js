const fs = require('fs').promises
const Node = require('./node')
const SIM_LENGTH = 10000

async function getLines () {
  const data = await fs.readFile('testnet.csv', 'utf8')
  const lines = data.split('\n')
  console.log(`Need at least ${Math.floor(SIM_LENGTH / 10) + 1} lines, got ${lines.length}`)
  if (lines.length < Math.floor(SIM_LENGTH / 10) + 1) {
    throw new Error(`Not enough data!`)
  }
  return lines
}

const graph = {}

function addLink (line) {
  const [from, to, fromMaxBalance, fromExchangeRate, toMaxBalance, toExchangeRate] = line.split(' ')
  if (from === 'from' || from === '') {
    // CAVEAT - this influences the cadence of adding links
    return
  }
  if (!graph[from]) {
    graph[from] = new Node(from)
  }
  graph[from].addLink({
    peer: to,
    ourMinBalance: -parseInt(toMaxBalance),
    ourMaxBalance: parseInt(fromMaxBalance),
    ourExchangeRate: parseFloat(fromExchangeRate)
  })
  if (!graph[to]) {
    graph[to] = new Node(to)
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
  const lines = await getLines()
  let simStep = 0
  while (simStep < SIM_LENGTH) {
    if (simStep % 10 === 0) {
      console.log(`Sim step ${simStep}, adding link`)
      const line = lines[simStep / 10]
      addLink(line)
    }
    simStep++
  }
  console.log(graph)
}

// ...
run()
