
const NUM_NODES = 100;
const NUM_NEIGHBORS = 10; // each node will have 10 neighbors
const maxMaxBalance = 1000;
const minExchangeRate = 1;
const maxExchangeRate = 5;

for (let i = 0; i < NUM_NODES; i++) {
  for (let j = 0; j < NUM_NEIGHBORS / 2; j++) {
    const neighbor = Math.floor(Math.random() * NUM_NODES);
    const maxBalance = Math.floor(Math.random() * maxMaxBalance);
    const exchangeRate = Math.random() * (maxExchangeRate - minExchangeRate) + minExchangeRate;
    if (i < neighbor) {
        console.log(`node ${i} neighbor ${neighbor} max balance ${maxBalance} exchange rate ${exchangeRate}`);
    } else if (i > neighbor) {
        console.log(`node ${neighbor} neighbor ${i} max balance ${maxBalance} exchange rate ${exchangeRate}`);
    }
  }
}