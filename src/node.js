const genRanHex = size => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')

class Node {
  // id
  // links
  // inbox
  // outbox
  // msgCallback
  constructor (id, msgCallback) {
    this.id = id
    this.links = {}
    this.inbox = []
    this.outbox = []
    this.msgCallback = msgCallback
  }

  addLink ({ peer, ourMinBalance, ourMaxBalance, ourExchangeRate, whoInitiated }) {
    this.links[peer] = {
      ourMinBalance,
      ourMaxBalance,
      ourExchangeRate,
      whoInitiated
    }
    this.inbox.push({ from: peer, msg: 'Link was added' })
  }
  receiveMessage (from, msg) {
    console.log(`Node ${this.id} received message from ${from}: ${msg.msg}`)
    this.inbox.push({ from, msg })
  }
  processMessages () {
    while (this.inbox.length) {
      const { from, msg } = this.inbox.shift()
      console.log(`Node ${this.id} processing message from ${from}: ${msg.msg}`)
      if (msg === 'Link was added') {
        console.log(`Node ${this.id} processing addLink from ${from}`)
        if (typeof this.links[from] === 'undefined') {
          throw new Error('Link data not found!')
        }
        if (this.links[from].whoInitiated === 'us') {
          const newProbeForlink = genRanHex(16)
          this.msgCallback(from, { msg: 'here is a probe!', probe: newProbeForlink })
        } else if (this.links[from].whoInitiated === 'they') {
        }
      }
    }
  }
}

module.exports = Node
