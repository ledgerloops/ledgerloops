const network = {};

const NUM_NODES = 10;
const NUM_NEIGHBOURS = 5;
const PROBE_ID_LEN = 20;

function getRandomInt (max, avoid) {
    let ret;
    do {
        ret = Math.floor(Math.random() * max);
    } while (avoid.indexOf(ret) != -1);
    return ret;
}

function genNeighbours(max, num, node) {
    let list = [ node ];
    do {
        list.push(getRandomInt(max, list));
    } while (list.length - 1 < num);
    return list.splice(1);
}

function getRandomString (length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const charactersLength = characters.length;
    let counter = 0;
    while (counter < length) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
      counter += 1;
    }
    return result;
}

function genNetwork () {
    for (let i = 0; i < NUM_NODES; i++) {
        network[i] = {
            neighbours: genNeighbours(NUM_NODES, NUM_NEIGHBOURS, i),
            probesSent: {},
            probesCreated: {},
            inbox: {},
            received: {},
            returns: {}
        };
    }
}

function sendProbe(node, probe, neighbourIndex) {
    network[node].probesSent[probe] = neighbourIndex;
    const neighbour = network[node].neighbours[neighbourIndex];
    network[neighbour].inbox[probe] = node;
}

function addProbe (node) {
    const newProbe = getRandomString(PROBE_ID_LEN);
    network[node].probesCreated[newProbe] = true;
    sendProbe(node, newProbe, 0);
}

function returnProbe (node, probe) {
    if (network[node].received[probe] === undefined) {
        throw new Error('unknown original sender!');
    }
    const returnTo = network[node].received[probe];
    network[returnTo].returns[probe] = true;
}

function handleReceivedProbe(node, probe) {
    if (network[node].probesSent[probe] !== undefined) {
        console.log(`Loop! ${probe} ${node}`);
        process.exit(0);
    } else {
        sendProbe(node, probe, 0);
    }
}

function handleReturnsProbe(node, probe) {
    if (network[node].probesSent[probe] === undefined) {
        throw new Error('unknown return!');
    }
    const neighbourId = network[node].probesSent[probe] + 1;
    if (neighbourId == NUM_NEIGHBOURS) {
        returnProbe(node, probe);
        delete network[node].probesSent[probe];
    } else {
        sendProbe(node, probe, neighbourId);
    }
}

function genBatchesOut() {
    for (let i = 0; i < NUM_NODES; i++) {
        network[i].received = network[i].inbox;
    }
    for (let i = 0; i < NUM_NODES; i++) {
            network[i].inbox = [];
        for (const j in network[i].received) {
            handleReceivedProbe(i, j);
        }
        network[i].incoming = [];
        for (const j in network[i].returns) {
            handleReturnsProbe(i, j);
        }
        network[i].returns = [];
    }
        
        // look at incoming probes
        // for each new incoming one, check if it's a looper
        // if not, check if it's a backer
        // for each one that came back, forward to next neighbour, or back, or delete
        // if not, forward to lowest neighbour
}

// lifecycle:
// - create a probe, send it to the inbox of the first neighbour
// - jo

function printNetwork() {
    for (let i = 0; i < NUM_NODES; i++) {
        console.log(i, network[i].neighbours, network[i].probesSent, network[i].probesCreated, network[i].inbox, network[i].received);
    }
    console.log();
}
// ...
genNetwork();
printNetwork();
addProbe(1);
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();
genBatchesOut();
printNetwork();