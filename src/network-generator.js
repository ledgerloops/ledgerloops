const ngraphGen = require('ngraph.generators')
const graph = ngraphGen.wattsStrogatz(30, 4, 0.10)
console.log('from to fromMaxBalance fromExchangeRate toMaxBalance toExchangeRate')
graph.forEachLink(function (link) {
  link.data = {
    fromMaxBalance: Math.floor(Math.random() * 1000),
    fromExchangeRate: Math.random() * 5 + 1,
    toMaxBalance: Math.floor(Math.random() * 1000),
    toExchangeRate: Math.random() * 5 + 1
  }
  console.log(`${link.fromId} ${link.toId} ${link.data.fromMaxBalance} ${link.data.fromExchangeRate} ${link.data.toMaxBalance} ${link.data.toExchangeRate}`)
})
