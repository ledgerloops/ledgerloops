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
    this.pairs = {}
    this.probesSeen = {}
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
    this.inbox.push({ from: peer, msg: { msg: 'Link was added' } })
  }
  receiveMessage (from, msg) {
    console.log(`Node ${this.id} received message from ${from}: ${msg.msg}`)
    this.inbox.push({ from, msg })
  }
  processMessages () {
    while (this.inbox.length) {
      const { from, msg } = this.inbox.shift()
      console.log(`Node ${this.id} processing message from ${from}: ${msg.msg}`)
      if (msg.msg === 'Link was added') {
        console.log(`Node ${this.id} processing addLink from ${from}`)
        if (typeof this.links[from] === 'undefined') {
          throw new Error('Link data not found!')
        }
        if (this.links[from].whoInitiated === 'us') {
          const newProbeForlink = genRanHex(8)
          const neighbors = Object.keys(this.links)
          neighbors.forEach(neighbor => {
            if (neighbor !== from) {
              if (typeof this.pairs[`${neighbor} ${from}`] === 'undefined') {
                this.pairs[`${neighbor} ${from}`] = { probesSent: [] }
              }
              this.pairs[`${neighbor} ${from}`].probesSent.push(newProbeForlink)
            }
            this.msgCallback(neighbor, { msg: 'here is a probe!', probe: newProbeForlink })
            this.probesSeen[newProbeForlink] = neighbor
          })
          this.msgCallback(from, { msg: 'here is a probe!', probe: newProbeForlink })
        } else if (this.links[from].whoInitiated === 'they') {
          this.msgCallback(from, { msg: 'nice to meet you!' })
        }
      } else if (msg.msg === 'here is a probe!') {
        console.log(`Node ${this.id} processing probe from ${from}`)
        if (this.probesSeen[msg.probe] !== undefined) {
          console.log('LOOP FOUND!')
        }
        this.probesSeen[msg.probe] = from
        const neighbors = Object.keys(this.links)
        neighbors.forEach(neighbor => {
          if (neighbor !== from) {
            if (typeof this.pairs[`${neighbor} ${from}`] === 'undefined') {
              this.pairs[`${neighbor} ${from}`] = { probesSent: [] }
            }
            if (this.pairs[`${neighbor} ${from}`].probesSent.includes(msg.probe)) {
              this.msgCallback(neighbor, { msg: 'nice to meet you!' })
            }
            this.pairs[`${neighbor} ${from}`].probesSent.push(msg.probe)
            this.msgCallback(neighbor, { msg: 'here is a probe!', probe: msg.probe })
          }
        })
      }
    }
  }
}

module.exports = Node
