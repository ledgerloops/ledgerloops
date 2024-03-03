class Node {
  // id
  // links
  constructor (id) {
    this.id = id
    this.links = {}
  }

  addLink ({ peer, ourMinBalance, ourMaxBalance, ourExchangeRate }) {
    this.links[peer] = {
      ourMinBalance,
      ourMaxBalance,
      ourExchangeRate
    }
  }
}

module.exports = Node
