'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');

function rng(seed) {
  // Deterministic generator for repeatable tests.
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ent = (label, weight, color) => ({ id: 'id-' + label, label, weight, color: color || '#00f5a0' });

test('slice angles add up to 360 degrees and follow the weights', () => {
  const es = [ent('a', 1), ent('b', 3), ent('c', 2)];
  const s = E.sliceAngles(es);
  assert.ok(Math.abs(s[s.length - 1].end - 360) < 1e-9);
  assert.ok(Math.abs(s[1].span - 180) < 1e-9, 'weight 3 of 6 is 180 degrees');
  assert.equal(s[0].start, 0);
});

test('the pointer reads the slice under it after the wheel turns', () => {
  const es = [ent('a', 1), ent('b', 1)];
  // Slice a covers 0-180 measured from the top. With no rotation the pointer sits on a.
  assert.equal(E.winnerAt(es, 0), 0);
  // Turn the wheel 180 degrees clockwise: the pointer now sits on b.
  assert.equal(E.winnerAt(es, 180), 1);
  assert.equal(E.winnerAt(es, 360 + 180), 1, 'full turns do not change the result');
});

test('a planned spin always stops inside its winning slice', () => {
  const es = [ent('a', 1), ent('b', 4), ent('c', 2), ent('d', 1)];
  const rand = rng(2026);
  for (let i = 0; i < 2000; i++) {
    const plan = E.planSpin({ entries: es, currentRotation: (i * 37) % 360, rand01: rand, minTurns: 5, duration: 5000 });
    const landed = E.winnerAt(es, plan.R0 + plan.D);
    assert.equal(landed, plan.winnerIndex, 'run ' + i + ' landed on the wrong slice');
    assert.ok(plan.D >= 5 * 360, 'at least five full turns');
  }
});

test('the winner is chosen in proportion to weight', () => {
  const es = [ent('a', 1), ent('b', 3)];
  const rand = rng(7);
  let aWins = 0;
  const n = 40000;
  for (let i = 0; i < n; i++) if (E.chooseWinnerIndex(es, rand) === 0) aWins++;
  const share = aWins / n;
  assert.ok(Math.abs(share - 0.25) < 0.01, 'weight 1 of 4 should win about 25% of the time, got ' + share);
});

test('the spin profile starts and ends at rest and never reverses', () => {
  assert.equal(E.easeSpin(0), 0);
  assert.equal(E.easeSpin(1), 1);
  let prev = -1;
  for (let i = 0; i <= 1000; i++) {
    const v = E.easeSpin(i / 1000);
    assert.ok(v >= prev - 1e-12, 'position must not go backwards');
    prev = v;
  }
  // Speed near the start is low, rises, then falls back towards zero at the end.
  const speed = (u) => (E.easeSpin(u + 1e-4) - E.easeSpin(u - 1e-4)) / 2e-4;
  assert.ok(speed(0.001) < speed(0.1), 'accelerates from rest');
  assert.ok(speed(0.999) < speed(0.6), 'slows to a stop');
  assert.ok(speed(0.999) < 0.05, 'nearly stopped at the end');
});

test('rotation at time zero is the start angle and at the end is the planned angle', () => {
  const es = [ent('a', 1), ent('b', 1)];
  const plan = E.planSpin({ entries: es, currentRotation: 30, rand01: rng(1), minTurns: 5, duration: 4000 });
  assert.equal(E.rotationAt(plan, 0), 30);
  assert.ok(Math.abs(E.rotationAt(plan, 4000) - (30 + plan.D)) < 1e-9);
});

test('validation rejects bad labels, weights and colours', () => {
  assert.throws(() => E.sanitizeLabel('   '), /cannot be empty/);
  assert.throws(() => E.sanitizeLabel('x'.repeat(31)), /30 characters/);
  assert.equal(E.sanitizeLabel('  Pizza\u0007 '), 'Pizza');
  assert.throws(() => E.sanitizeWeight(0), /whole number/);
  assert.throws(() => E.sanitizeWeight(11), /whole number/);
  assert.throws(() => E.sanitizeWeight(2.5), /whole number/);
  assert.throws(() => E.sanitizeColor('red'), /Colour/);
  assert.equal(E.sanitizeColor('#ABCDEF'), '#abcdef');
});

function fakeStorage() {
  const store = {};
  return {
    store,
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
  };
}

test('the dispatcher adds, updates, removes and enforces limits', () => {
  const st = fakeStorage();
  const d = E.createDispatcher({ vault: E.createVault({ storage: st }), rand01: rng(5), now: () => 1000 });
  assert.equal(d.state().entries.length, 3, 'starts with three placeholder options');
  const added = d.dispatch('choices.add', { label: 'Pizza', weight: 2 });
  assert.equal(added.label, 'Pizza');
  assert.equal(added.weight, 2);
  d.dispatch('choices.update', { id: added.id, label: 'Burger', weight: 5 });
  assert.equal(d.state().entries.find((e) => e.id === added.id).label, 'Burger');
  assert.throws(() => d.dispatch('choices.add', { label: '' }), /cannot be empty/);
  d.dispatch('choices.remove', { id: added.id });
  assert.equal(d.state().entries.length, 3);
  assert.throws(() => d.dispatch('choices.remove', { id: 'nope' }), /not found/);
  for (let i = 0; i < 37; i++) d.dispatch('choices.add', { label: 'L' + i }); // 3 + 37 = 40, the limit
  assert.throws(() => d.dispatch('choices.add', { label: 'one too many' }), /At most 40/);
});

test('presets save and load a copy of the entries', () => {
  const st = fakeStorage();
  const d = E.createDispatcher({ vault: E.createVault({ storage: st }), rand01: rng(9), now: () => 1000 });
  d.dispatch('choices.savePreset', { name: 'Lunch' });
  d.dispatch('choices.add', { label: 'Extra' });
  assert.equal(d.state().entries.length, 4);
  d.dispatch('choices.loadPreset', { name: 'Lunch' });
  assert.equal(d.state().entries.length, 3, 'loading restores the saved list');
  assert.throws(() => d.dispatch('choices.loadPreset', { name: 'Nope' }), /not found/);
});

test('data is stored under the dr_vault_v1_ namespace and survives a reload', () => {
  const st = fakeStorage();
  const v = E.createVault({ storage: st });
  const d1 = E.createDispatcher({ vault: v, rand01: rng(3), now: () => 1000 });
  d1.dispatch('choices.add', { label: 'Saved item', weight: 4 });
  d1.dispatch('logs.add', { winner: 'Saved item' });
  const keys = Object.keys(st.store);
  assert.ok(keys.length > 0 && keys.every((k) => k.startsWith('dr_vault_v1_')), keys.join(', '));
  const d2 = E.createDispatcher({ vault: E.createVault({ storage: st }), rand01: rng(4), now: () => 2000 });
  assert.ok(d2.state().entries.some((e) => e.label === 'Saved item'));
  assert.equal(d2.state().logs[0].winner, 'Saved item');
});

test('history keeps only the newest 200 results and can be cleared', () => {
  const d = E.createDispatcher({ vault: E.createVault({ storage: null }), rand01: rng(6), now: () => 1000 });
  for (let i = 0; i < 205; i++) d.dispatch('logs.add', { winner: 'W' + i });
  assert.equal(d.state().logs.length, 200);
  assert.equal(d.state().logs[0].winner, 'W204');
  d.dispatch('logs.clear');
  assert.equal(d.state().logs.length, 0);
});

test('the dispatcher rejects unknown commands and falls back when storage is blocked', () => {
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const d = E.createDispatcher({ vault: E.createVault({ storage: broken }), rand01: rng(8), now: () => 1000 });
  assert.equal(d.state().entries.length, 3, 'still works without storage');
  d.dispatch('choices.add', { label: 'Still works' });
  assert.equal(d.state().entries.length, 4);
  assert.throws(() => d.dispatch('no.such.command'), /Unknown command/);
});

test('wheel.spin plans a spin and reports the winner', () => {
  const d = E.createDispatcher({ vault: E.createVault({ storage: null }), rand01: rng(11), now: () => 1000 });
  const r = d.dispatch('wheel.spin', { rotation: 0, duration: 5000 });
  assert.ok(r.plan.D >= 5 * 360);
  assert.ok(d.state().entries.some((e) => e.id === r.winnerId));
});
