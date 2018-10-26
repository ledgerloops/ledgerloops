var sha256 = require('hashlocks').sha256;
var randomBytes = require('randombytes');

/**
 * Finds LedgerLoops for a SNAP agent
 * @constructor
 * @param {object} agent - the SNAP agent to message through
 */
function Loops(agent) {
  this._agent = agent;
  this._probesSent = {};
  this._probesRcvd = {};
  this._preimages = {};
}

Loops.prototype = {
  _setRcvd: function (peerName, direction, routeId, value) {
    if (typeof this._probesRcvd[peerName] === 'undefined') {
      this._probesRcvd[peerName] = {
        cwise: {},
        fwise: {}
      };
    }
    this._probesRcvd[peerName][direction][routeId] = value;
  },
  _setSent(peerName, direction, routeId, value) {
    if (typeof this._probesSent[peerName] === 'undefined') {
      this._probesSent[peerName] = {
        cwise: {},
        fwise: {}
      };
    }
    this._probesSent[peerName][direction][routeId] = value;
  },
  _beneficial: function (from, to, amount) {
    const balances = this._agent.getBalances();
    const minBalanceDiff = + balances[from].current
        - (balances[from].payable - amount)
        - balances[to].current
        - balances[to].receivable;
    console.log('comparing', minBalanceDiff, '2*', amount, balances);
    return (minBalanceDiff >= 2 * amount);
  },

  /**
   * Get a response for an incoming conditional transfer
   * @param {string} peerName - peer the COND comes in from
   * @param (object} msgObj - the SNAP message
   */
  getResponse: function (peerName, msgObj) {
    // console.log('getResponse', peerName, msgObj);
    if (msgObj.condition) {
      if (this._preimages[msgObj.condition]) {
        return Promise.resolve(this._preimages[msgObj.condition].toString('hex'));
      }
      for (let fwdPeerName in this._probesRcvd) {
        if (this._probesRcvd[fwdPeerName].fwise[msgObj.routeId] && this._beneficial(peerName, fwdPeerName, msgObj.amount)) {
          // console.log('forwarding from', peerName, 'to', fwdPeerName);
          return this._agent._propose(fwdPeerName, msgObj.amount, msgObj.condition, msgObj.routeId).then((result) => {
            // console.log('passing back fulfill', peerName, fwdPeerName, result);
            return result;
          }, (err) => {
            // console.log('onward peer rejected', err.message);
            throw err;
          });
        }
      }
      return Promise.reject(new Error('cannot route ' + msgObj.routeId));
    } else {
      const routeId = this._agent._myName + '-' + randomBytes(8).toString('hex');
      // console.log('starting probe after accepting an unconditional proposal from', peerName, routeId);
      this._setSent(peerName, 'cwise', routeId, false);
      this._setRcvd(peerName, 'fwise', routeId, true);
      return Promise.resolve();
    }
  },
  handleControlMessage: function (peerName, msgObj) {
    if (msgObj.msgType === 'PROBES') {
      // console.log('handling probes', peerName, msgObj);
      ['cwise', 'fwise'].map(direction => {
        msgObj[direction].map(routeId => {
          this._setRcvd(peerName, direction, routeId, true);
        });
      });
    }
  },
  _considerPair: function (from, to, direction, balanceDiff, startLoops) {
    if (!this._probesRcvd[from]) {
      return;
    }
    // console.log('considering pair', from, to, direction);
    for (let routeId in this._probesRcvd[from][direction]) {
      if (this._probesSent[to] && this._probesSent[to][direction][routeId]) {
        if (startLoops && balanceDiff > 0) {
          // console.log('LOOP FOUND!');
          const preimage = randomBytes(32);
          const hashHex = sha256(preimage).toString('hex');
          this._preimages[hashHex] = preimage;
          this._agent._propose(to, Math.floor(balanceDiff / 2), hashHex, routeId).then(preimage => {
            // console.log('that worked!', routeId);
          }, (err) => {
            // console.log('that did not work!', routeId, err.message);
          });
        }
      } else {
        this._setSent(to, direction, routeId, false);
      }
    }
  },
  forwardProbes: function (startLoops) {
    // a cwise probe should be forwarded to peers whose balance is lower
    // an fwise probe should be forwarded to peers whose balance is higher
    const balances = this._agent.getBalances();
    let ladder = [];
    for (let peerName in balances) {
      ladder.push(peerName);
    }
    ladder.sort((a, b) => balances[a].current - balances[b].current);
    for (let i = 0; i < ladder.length; i++) {
      if (ladder[i] === 'bank') {
        continue;
      }
      for (let j = i + 1; j < ladder.length; j++) {
        if (ladder[j] === 'bank') {
          continue;
        }
        console.log(`The balance of ${ladder[i]} (${balances[ladder[i]].current}) is lower than that of ${ladder[j]} (${balances[ladder[j]].current}), forwarding fwise and v.v.`);
        this._considerPair(ladder[i], ladder[j], 'fwise');
	this._considerPair(ladder[j], ladder[i], 'cwise',
          + balances[ladder[j]].current
          - balances[ladder[j]].payable
          - balances[ladder[i]].current
          - balances[ladder[i]].receivable, startLoops); // even if set to true, only do it on cwise
      }
    }
  },
  sendProbes: function () {
    for (let peerName in this._probesSent) {
      let msgObj = {
        msgType: 'PROBES',
        cwise: [],
        fwise: []
      };
      ['cwise', 'fwise'].map(direction => {
        for (let routeId in this._probesSent[peerName][direction]) {
          if (!this._probesSent[peerName][direction][routeId]) {
            // console.log('sending out', peerName, direction, routeId);
            this._probesSent[peerName][direction][routeId] = true;
            msgObj[direction].push(routeId);
          }
        }
      });
      if (msgObj.cwise.length || msgObj.fwise.length) {
        // console.log(`sending probes from ${this._agent._myName} to ${peerName}`, msgObj);
        this._agent._sendCtrl(peerName, msgObj);
      }
    }
  }
};

module.exports = Loops;
