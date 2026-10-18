// -----------------------------------------------------------------------------
// Readings of the attributes (src/model.js) and the Gladys features
// (src/devices.js), with the values of whirlpool-sixth-sense.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { buildDevice, deviceStates, planOf } from '../src/devices.js';
import { kindOf, readAircon, readLaundry, readOven } from '../src/model.js';
import { aircon, dryer, oven, washer } from './fixtures/whirlpool.js';

const attrs = (object) => new Map(Object.entries(object));

test('the kinds of the reference, in its order', () => {
  assert.equal(kindOf('DDM_LAUNDRY_VMAX20_WHIRLPOOL_WASHER8_V2'), 'washer');
  assert.equal(kindOf('DDM_LAUNDRY_VMAX20_MAYTAG_DRYER_6_V1'), 'dryer');
  assert.equal(kindOf('ddm_laundry_washer_dryer_combo'), 'dryer');
  assert.equal(kindOf('DDM_COOKING_BIO_SELF_CLEAN_TOURMALINE_V2'), 'oven');
  assert.equal(kindOf('airconditioner'), 'aircon');
  assert.equal(kindOf('ddm_ted_refrigerator_v12'), undefined);
  assert.equal(kindOf('ddm_cooking_unknown_v9'), undefined);
  assert.equal(kindOf(undefined), undefined);
});

test('washer: states, phase only during a cycle, time remaining, door', () => {
  const standby = readLaundry('washer', attrs(washer()));
  assert.deepEqual(standby, {
    online: true,
    state: 'standby',
    phase: 'none',
    cycle: { number: 88 },
    remainingMinutes: 0,
    doorOpen: true,
  });
  const running = readLaundry(
    'washer',
    attrs({
      ...washer(),
      Cavity_CycleStatusMachineState: '7',
      WashCavity_CycleStatusSpinning: '1',
      Cavity_TimeStatusEstTimeRemaining: '61',
      Cavity_OpStatusDoorOpen: '0',
    }),
  );
  assert.equal(running.state, 'running');
  assert.equal(running.phase, 'spinning');
  assert.equal(running.remainingMinutes, 2, 'rounded up');
  assert.equal(running.doorOpen, false);
  for (const [code, state] of [
    ['2', 'delayed'],
    ['6', 'paused'],
    ['8', 'finishing'],
    ['9', 'error'],
    ['10', 'complete'],
    ['17', 'error'],
    ['19', 'cancelled'],
    ['42', 'unknown'],
  ]) {
    assert.equal(
      readLaundry('washer', attrs({ ...washer(), Cavity_CycleStatusMachineState: code })).state,
      state,
    );
  }
  const unknown = readLaundry('washer', new Map());
  assert.equal(unknown.state, null);
  assert.equal(unknown.phase, null);
  assert.equal(unknown.remainingMinutes, null);
  assert.equal(unknown.doorOpen, null);
  assert.equal(
    readLaundry('washer', attrs({ ...washer(), Cavity_CycleStatusMachineState: ' 1x' })).state,
    null,
    'not an integer',
  );
});

test('dryer: the cycle names of the reference, the cycle name first', () => {
  const r = readLaundry('dryer', attrs(dryer()));
  assert.equal(r.state, 'running');
  assert.equal(r.phase, 'drying');
  assert.deepEqual(r.cycle, { key: 'towels' });
  assert.equal(r.remainingMinutes, 31);
  assert.deepEqual(
    readLaundry('dryer', attrs({ ...dryer(), Cavity_CycleSetCycleName: 'Eco' })).cycle,
    { name: 'Eco' },
  );
  assert.deepEqual(
    readLaundry('dryer', attrs({ ...dryer(), DryCavity_CycleSetCycleSelect: '99' })).cycle,
    { number: 99 },
  );
});

test('oven: tenths of a degree, 0 is none, an absent lower cavity', () => {
  const r = readOven(attrs(oven()));
  assert.deepEqual(r.upper, { state: 'preheating', temperature: 37.7, doorOpen: false });
  assert.deepEqual(r.lower, { state: null, temperature: 0.4, doorOpen: null });
  const off = readOven(attrs({ ...oven(), OvenUpperCavity_DisplStatusDisplayTemp: '0' }));
  assert.equal(off.upper.temperature, null);
});

test('air conditioner: modes of aircon.py, tenths of a degree', () => {
  assert.deepEqual(readAircon(attrs(aircon())), {
    online: true,
    power: false,
    mode: 2,
    target: 30,
    temperature: 23,
    humidity: 56,
  });
  const mode = (set, status) =>
    readAircon(attrs({ ...aircon(), Cavity_OpSetMode: set, Cavity_OpStatusMode: status })).mode;
  assert.equal(mode('4', '7'), 0, '6th Sense is auto');
  assert.equal(mode('1', '1'), 1);
  assert.equal(mode('1', '7'), 1);
  assert.equal(mode('3', '6'), 2);
  assert.equal(mode('2', '5'), 4);
  assert.equal(mode('9', '9'), null);
});

test('devices: a lower cavity when present, and kept once created', () => {
  const gladys = createFakeGladys();
  const appliance = { said: 'S1', kind: 'oven', name: 'Oven', model: 'M', category: 'Cooking' };
  const both = { ...oven(), OvenLowerCavity_OpStatusState: '0' };
  const plan = planOf(appliance, attrs(both));
  const built = buildDevice(gladys, appliance, plan, 'en');
  const keys = built.features.map((f) => f.external_id.split(':').pop());
  assert.deepEqual(keys, [
    'upper-state',
    'upper-temperature',
    'upper-door',
    'lower-state',
    'lower-temperature',
    'lower-door',
  ]);
  assert.equal(built.features[0].name, 'Oven state');
  // The lower cavity reads "not present" later: the created device keeps it.
  const kept = planOf(appliance, attrs(oven()), built);
  assert.equal(kept.specs.length, 6);
  assert.equal(planOf(appliance, attrs(oven())).specs.length, 3);
});

test('devices: text states carry text, numbers carry state, unknowns nothing', () => {
  const gladys = createFakeGladys();
  const appliance = { said: 'W1', kind: 'washer', name: 'Washer' };
  const plan = planOf(appliance, attrs(washer()));
  const states = deviceStates(
    gladys,
    appliance,
    plan,
    readLaundry('washer', attrs(washer())),
    'fr',
  );
  assert.deepEqual(
    states.map((s) => [s.key, s.value]),
    [
      ['state', { text: 'standby' }],
      ['cycle', { text: 'Cycle 88' }],
      ['phase', { text: 'none' }],
      ['remaining', { state: 0 }],
      ['door', { state: 0 }],
    ],
  );
  assert.deepEqual(
    deviceStates(gladys, appliance, plan, readLaundry('washer', new Map()), 'fr'),
    [],
  );
  const built = buildDevice(gladys, appliance, plan, 'fr');
  const state = built.features.find((f) => f.external_id.endsWith(':state'));
  assert.equal(state.name, 'État');
  assert.ok(state.supported_options.some((o) => o.value === 'complete' && o.label === 'Terminé'));
});

test('devices: the air conditioner commands, strictly validated', () => {
  const appliance = { said: 'A1', kind: 'aircon', name: 'AC' };
  const plan = planOf(appliance, attrs(aircon()));
  const spec = (key) => plan.specs.find((s) => s.key === key);
  assert.deepEqual(
    spec('target').write(21.4),
    {
      attributes: { Sys_OpSetTargetTemp: '210' },
      expect: { target: 21 },
    },
    'rounded to the 1 °C step',
  );
  for (const bad of [null, '', true, NaN, 15.9, 30.1, 'x']) {
    assert.deepEqual(spec('target').write(bad), { refuse: 'refused' }, String(bad));
  }
  assert.deepEqual(spec('mode').write(2).attributes, { Cavity_OpSetMode: '3' });
  assert.deepEqual(spec('mode').write(3), { refuse: 'refused' }, 'no drying mode');
  assert.deepEqual(spec('power-on').write(1).attributes, { Sys_OpSetPowerOn: '1' });
  assert.deepEqual(spec('power-off').write(1).attributes, { Sys_OpSetPowerOn: '0' });
  assert.deepEqual(spec('power-on').write(0), { refuse: 'pressOnly' });
  assert.equal(spec('power').write, undefined, 'the on/off state is never written');
  const noHumidity = planOf(appliance, attrs({ Online: '1' }));
  assert.ok(!noHumidity.specs.some((s) => s.key === 'humidity'));
});
