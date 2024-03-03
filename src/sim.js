const fs = require('fs').promises

const SIM_LENGTH = 300

async function getLines () {
  const data = await fs.readFile('testnet.csv', 'utf8')
  return data.split('\n')
}

const graph = {}

function addLink (line) {
  const [from, to, fromMaxBalance, fromExchangeRate, toMaxBalance, toExchangeRate] = line.split(' ')
  if (from === 'from' || from === '') {
    return
  }
  if (!graph[from]) {
    graph[from] = {}
  }
  graph[from][to] = {
    ourMinBalance: -parseInt(toMaxBalance),
    ourMaxBalance: parseInt(fromMaxBalance),
    ourExchangeRate: parseFloat(fromExchangeRate)
  }
  if (!graph[to]) {
    graph[to] = {}
  }
  graph[to][from] = {
    ourMinBalance: -parseInt(fromMaxBalance),
    ourMaxBalance: parseInt(toMaxBalance),
    ourExchangeRate: parseFloat(toExchangeRate)
  }
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
