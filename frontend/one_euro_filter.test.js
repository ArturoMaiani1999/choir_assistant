const assert = require('node:assert/strict');
const { OneEuroFilter } = require('./one_euro_filter.js');

const filter = new OneEuroFilter();
assert.equal(filter.filter(10, 0), 10);
const noisy = [10.02, 9.98, 10.01, 9.99, 10.015].map((value, index) => filter.filter(value, (index + 1) * .02));
assert.ok(Math.max(...noisy) - Math.min(...noisy) < .04, 'steady input is smoothed');
filter.reset();
assert.equal(filter.filter(20, 1), 20, 'reset removes stale state');
assert.equal(filter.filter(null, 1.02), null, 'unvoiced input resets the filter');
console.log('one euro filter tests passed');
