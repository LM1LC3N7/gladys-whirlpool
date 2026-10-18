// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake Whirlpool cloud behind the transport. Timers and Date are
// mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { WhirlpoolApp } from '../src/app.js';
import { ACTIONS, CLIENTS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { WhirlpoolError } from '../src/http.js';
import { EMAIL, HOUR, MINUTE, NOW, PASSWORD, SAIDS, SECOND } from './fixtures/whirlpool.js';
import { fakeWhirlpool, memoryStore, settle } from './helpers/fakeWhirlpool.js';

const CONFIG = { email: EMAIL, password: PASSWORD, brand: 'whirlpool', region: 'eu' };
const device = (said) => `ext:test-integration:appliance:${said}`;
const feature = (said, key) => `${device(said)}:${key}`;
const manifest = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const core = readFileSync(new URL('./fixtures/core-units.json', import.meta.url), 'utf8');

async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    server = fakeWhirlpool(),
    now = NOW,
    create = true,
    logs = [],
    mock = true,
  } = {},
) {
  if (mock) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  }
  const gladys = createFakeGladys({ config });
  const app = new WhirlpoolApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 5 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create) {
    for (const d of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(d);
    }
    await advance(2 * SECOND, SECOND);
  }
  const created = (said) => gladys.fake.devices.find((d) => d.external_id === device(said));
  const set = async (said, key, value) => {
    const d = created(said);
    const f = d.features.find((x) => x.external_id === feature(said, key));
    const ack = await gladys.fake.setValue(d, f, value);
    await settle();
    return ack;
  };
  return { gladys, app, server, store, advance, created, set, logs };
}

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

const last = (gladys, said, key) => gladys.fake.lastState(feature(said, key));
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const SECRETS = [
  PASSWORD,
  ...Object.values(CLIENTS).flatMap((brands) => Object.values(brands).map((c) => c.secret)),
];
const noSecret = (server, logs, store) => {
  const text = [logs.join('\n'), JSON.stringify(store?.data ?? null)].join('\n');
  for (const secret of [...SECRETS, ...server.secrets.filter((s) => s.startsWith('access'))]) {
    assert.ok(!text.includes(secret), 'a secret reached the logs or /data');
  }
  assert.ok(!logs.join('\n').includes(EMAIL), 'the e-mail reached the logs');
};

test('without credentials, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { email: EMAIL } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /e-mail and the password/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /mot de passe/);
});

test('Maytag in Europe has no app: said so, nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { ...CONFIG, brand: 'maytag' } });
  assert.equal(server.requests.length, 0);
  assert.match(message(gladys).en, /Maytag has no app in Europe/);
});

test('the sign-in of the reference, then one read: devices, states, status, nothing secret kept', async (t) => {
  const logs = [];
  const { gladys, server, store } = await setup(t, { logs });
  assert.deepEqual(
    server.requests.slice(0, 7).map((r) => `${r.method} ${r.path}`),
    [
      'POST /oauth/token',
      'GET /api/v3/appliance/all/account/12345',
      'GET /api/v1/share-accounts/appliances',
      `GET /api/v1/appliance/${SAIDS.washer}`,
      `GET /api/v1/appliance/${SAIDS.dryer}`,
      `GET /api/v1/appliance/${SAIDS.oven}`,
      `GET /api/v1/appliance/${SAIDS.sharedOven}`,
    ],
  );
  const [token, list, sharedList, data] = server.requests;
  assert.deepEqual(token.form, {
    grant_type: 'password',
    username: EMAIL,
    password: PASSWORD,
    client_id: 'whirlpool_emea_android_v2',
    client_secret: CLIENTS.eu.whirlpool.secret,
  });
  assert.equal(token.headers['User-Agent'], 'okhttp/3.12.0');
  assert.match(list.headers.Authorization, /^Bearer access-/);
  assert.equal(sharedList.headers['WP-CLIENT-BRAND'], 'Whirlpool');
  assert.equal(data.headers['Cache-Control'], 'no-cache');
  // The air conditioner (option off) and the fridge (not supported) are never read.
  assert.equal(server.reads(SAIDS.aircon).length, 0);
  assert.equal(server.reads(SAIDS.fridge).length, 0);

  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id).sort();
  assert.deepEqual(
    ids,
    [SAIDS.dryer, SAIDS.oven, SAIDS.sharedOven, SAIDS.washer].map(device).sort(),
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /4 appliance\(s\) Gladys can show \(out of 6\)/);

  // Washer in standby, door open; dryer drying "Towels" with 31 min left; oven preheating at 37.7 °C.
  assert.equal(last(gladys, SAIDS.washer, 'state'), 'standby');
  assert.equal(last(gladys, SAIDS.washer, 'phase'), 'none');
  assert.equal(last(gladys, SAIDS.washer, 'remaining'), 0);
  assert.equal(last(gladys, SAIDS.washer, 'door'), 0);
  assert.equal(last(gladys, SAIDS.washer, 'cycle'), 'Cycle 88');
  assert.equal(last(gladys, SAIDS.dryer, 'state'), 'running');
  assert.equal(last(gladys, SAIDS.dryer, 'phase'), 'drying');
  assert.equal(last(gladys, SAIDS.dryer, 'remaining'), 31);
  assert.equal(last(gladys, SAIDS.dryer, 'door'), 1);
  assert.equal(last(gladys, SAIDS.dryer, 'cycle'), 'Serviettes');
  assert.equal(last(gladys, SAIDS.oven, 'upper-state'), 'preheating');
  assert.equal(last(gladys, SAIDS.oven, 'upper-temperature'), 37.7);
  assert.equal(last(gladys, SAIDS.oven, 'upper-door'), 1);
  assert.equal(
    gladys.fake.discoveredDevices
      .find((d) => d.external_id === device(SAIDS.oven))
      .features.some((f) => f.external_id.includes('lower')),
    false,
    'no lower cavity',
  );
  assert.ok(
    gladys.fake.transports.some(
      (x) =>
        x.device_external_id === device(SAIDS.washer) && x.transport === DEVICE_TRANSPORTS.CLOUD,
    ),
  );
  // /data: the refresh token and the account id only.
  assert.deepEqual(Object.keys(store.data.session).sort(), ['account', 'accountId', 'refresh']);
  assert.ok(store.data.session.refresh.startsWith('refresh-'));
  noSecret(server, logs, store);
});

test('every feature is read only, with core units and types, never a switch', async (t) => {
  const { gladys } = await setup(t);
  const allowed = JSON.parse(core);
  for (const d of gladys.fake.discoveredDevices) {
    for (const f of d.features) {
      assert.equal(f.read_only, true, `${f.external_id} must be read only`);
      assert.notEqual(f.category, 'switch');
      assert.ok(allowed.types[f.category]?.includes(f.type), `${f.category}/${f.type}`);
      if (f.unit) {
        assert.ok(allowed.units[f.category]?.includes(f.unit), `${f.category} ${f.unit}`);
      }
    }
  }
  const oven = gladys.fake.discoveredDevices.find((d) => d.external_id === device(SAIDS.oven));
  assert.equal(
    oven.features.find((f) => f.external_id.endsWith('upper-temperature')).type,
    'probe',
    'an oven is kept out of the room temperature',
  );
});

test('a cycle that finishes fires the scene trigger once', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.set(SAIDS.washer, 'Cavity_CycleStatusMachineState', '7');
  server.set(SAIDS.washer, 'WashCavity_CycleStatusRinsing', '1');
  server.set(SAIDS.washer, 'Cavity_CycleSetCycleName', 'Whites');
  await advance(60 * SECOND);
  assert.equal(last(gladys, SAIDS.washer, 'state'), 'running');
  assert.equal(last(gladys, SAIDS.washer, 'phase'), 'rinsing');
  assert.equal(last(gladys, SAIDS.washer, 'remaining'), 68);
  assert.equal(last(gladys, SAIDS.washer, 'cycle'), 'Whites');
  assert.equal(gladys.fake.sceneEvents.length, 0);
  server.set(SAIDS.washer, 'Cavity_CycleStatusMachineState', '10');
  await advance(60 * SECOND);
  assert.equal(last(gladys, SAIDS.washer, 'state'), 'complete');
  assert.equal(last(gladys, SAIDS.washer, 'remaining'), 0);
  assert.deepEqual(gladys.fake.sceneEvents, [
    {
      key: 'cycle_finished',
      data: {
        appliance: device(SAIDS.washer),
        appliance_name: 'Washer',
        kind: 'washer',
        kind_label: 'lave-linge',
        cycle: 'Whites',
      },
    },
  ]);
  await advance(3 * 60 * SECOND);
  assert.equal(gladys.fake.sceneEvents.length, 1, 'once per cycle');
  // The key is the manifest's.
  assert.equal(manifest.scene_triggers[0].key, gladys.fake.sceneEvents[0].key);
});

test('a machine already complete at the start fires nothing', async (t) => {
  const server = fakeWhirlpool();
  server.set(SAIDS.washer, 'Cavity_CycleStatusMachineState', '10');
  const { gladys, advance } = await setup(t, { server });
  await advance(2 * MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 0);
});

test('the token is renewed by a timer ahead of its end, never with the password', async (t) => {
  const { server, store, advance } = await setup(t);
  assert.equal(server.tokenCalls('password').length, 1);
  await advance(49 * MINUTE, 30 * SECOND);
  assert.equal(server.tokenCalls('refresh_token').length, 0);
  await advance(2 * MINUTE, 30 * SECOND);
  const refresh = server.tokenCalls('refresh_token');
  assert.equal(refresh.length, 1, 'renewed 10 minutes before the end');
  assert.equal(refresh[0].form.client_id, 'whirlpool_emea_android_v2');
  assert.ok(refresh[0].form.refresh_token.startsWith('refresh-'));
  assert.equal(server.tokenCalls('password').length, 1);
  assert.equal(store.data.session.refresh, [...server.refreshes][0]);
  // The reads go on with the new token.
  const before = server.reads(SAIDS.washer).length;
  await advance(2 * MINUTE, 30 * SECOND);
  assert.ok(server.reads(SAIDS.washer).length > before);
  assert.equal(server.tokenCalls('password').length, 1);
});

test('a restart with a stored session renews it, without the password', async (t) => {
  const store = memoryStore();
  const first = fakeWhirlpool();
  const one = await setup(t, { store, server: first });
  one.app.stop();
  const server = fakeWhirlpool();
  server.refreshes = new Set([store.data.session.refresh]);
  const { gladys } = await setup(t, { store, server, create: false, mock: false });
  assert.equal(server.tokenCalls('password').length, 0);
  assert.equal(server.tokenCalls('refresh_token').length, 1);
  // The account id was kept: no getUserDetails.
  assert.equal(server.of('/api/v1/getUserDetails').length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('the account id from getUserDetails when the token answer has none', async (t) => {
  const server = fakeWhirlpool();
  server.accountInToken = false;
  const { gladys } = await setup(t, { server, create: false });
  assert.equal(server.of('/api/v1/getUserDetails').length, 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a refused password stops, survives a restart, and the button retries', async (t) => {
  const store = memoryStore();
  const server = fakeWhirlpool();
  server.password = 'another';
  const { gladys, app, advance } = await setup(t, { store, server, create: false });
  assert.match(message(gladys).en, /refused/);
  assert.equal(server.tokenCalls('password').length, 1);
  await advance(2 * HOUR, MINUTE);
  assert.equal(server.requests.length, 1, 'never posted again by itself');
  app.stop();
  const again = fakeWhirlpool();
  again.password = 'another';
  const second = await setup(t, { store, server: again, create: false, mock: false });
  assert.equal(again.requests.length, 0, 'the stop survives a restart');
  assert.match(message(second.gladys).en, /refused/);
  again.password = PASSWORD;
  const ack = await second.gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Connected/);
  assert.equal(store.data.block, null);
});

test('new credentials saved: one sign-in with them', async (t) => {
  const server = fakeWhirlpool();
  server.password = 'another';
  const { gladys } = await setup(t, { server, create: false });
  assert.match(message(gladys).en, /refused/);
  server.password = 'new-pass';
  await gladys.fake.configUpdated({ ...CONFIG, password: 'new-pass' });
  await settle();
  assert.equal(server.tokenCalls('password').length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a locked account (423) stops, never retried by itself', async (t) => {
  const store = memoryStore();
  const server = fakeWhirlpool();
  server.queue.push({ match: (r) => r.path === '/oauth/token', status: 423, body: '' });
  const { gladys, advance } = await setup(t, { store, server, create: false });
  assert.match(message(gladys).en, /locked/);
  await advance(3 * HOUR, MINUTE);
  assert.equal(server.requests.length, 1);
  assert.equal(store.data.block.kind, 'locked');
});

test('a refused refresh token: one password sign-in, then the reads go on', async (t) => {
  const { server, advance, gladys } = await setup(t);
  server.revokeRefresh();
  server.revokeAccess();
  await advance(2 * MINUTE, 30 * SECOND);
  assert.equal(server.tokenCalls('refresh_token').length, 1);
  assert.equal(server.tokenCalls('password').length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a session refused right after a renewal pauses 1 h, never in a loop', async (t) => {
  const { server, advance, gladys, store } = await setup(t);
  // Every API call refused from now on.
  server.before = (r) => {
    if (r.path !== '/oauth/token') {
      server.access.clear();
    }
  };
  await advance(2 * MINUTE, 30 * SECOND);
  assert.match(message(gladys).en, /refused again/);
  assert.equal(store.data.block.kind, 'session_refused');
  const count = server.requests.length;
  await advance(50 * MINUTE, MINUTE);
  assert.equal(server.requests.length, count, 'nothing before the hour');
  await advance(15 * MINUTE, MINUTE);
  assert.ok(server.requests.length > count, 'one new try after the hour');
  assert.ok(server.tokenCalls('password').length <= 3);
});

test('429: a pause of every path, kept across a restart', async (t) => {
  const store = memoryStore();
  const server = fakeWhirlpool();
  const { gladys, app, advance } = await setup(t, { store, server });
  server.queue.push({
    match: (r) => r.path.startsWith('/api/v1/appliance/'),
    status: 429,
    headers: { 'retry-after': '1800' },
  });
  await advance(MINUTE, 30 * SECOND);
  assert.match(message(gladys).en, /Too many requests: paused for 30 min/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Too many requests/);
  app.stop();
  const again = fakeWhirlpool();
  t.mock.timers.tick(5 * MINUTE);
  await setup(t, { store, server: again, create: false, mock: false });
  assert.equal(again.requests.length, 0, 'the pause survives a restart');
});

test('one appliance failing never hides the others', async (t) => {
  const { gladys, server, advance } = await setup(t);
  delete server.data[SAIDS.oven];
  server.set(SAIDS.washer, 'Cavity_OpStatusDoorOpen', '0');
  await advance(MINUTE, 30 * SECOND);
  assert.equal(last(gladys, SAIDS.washer, 'door'), 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const badges = gladys.fake.transports.filter((x) => x.device_external_id === device(SAIDS.oven));
  assert.equal(badges.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
});

test('an offline appliance is shown unreachable', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.set(SAIDS.dryer, 'Online', '0');
  await advance(MINUTE, 30 * SECOND);
  const badges = gladys.fake.transports.filter((x) => x.device_external_id === device(SAIDS.dryer));
  assert.equal(badges.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
});

test('the cloud down: retried after the interval, then later', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.down = true;
  await advance(MINUTE, 30 * SECOND);
  assert.match(message(gladys).en, /cannot be reached/);
  const count = server.requests.length;
  await advance(50 * SECOND, 10 * SECOND);
  assert.equal(server.requests.length, count, 'never sooner than the interval');
  server.down = false;
  await advance(2 * MINUTE, 30 * SECOND);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a reconnection to Gladys resends status and Discovery, keeps the pause', async (t) => {
  const { gladys, app, server, advance } = await setup(t);
  server.queue.push({ match: (r) => r.path.startsWith('/api/v1/appliance/'), status: 429 });
  await advance(MINUTE, 30 * SECOND);
  const published = gladys.fake.requests.filter((r) => r.path === '/discovered_device').length;
  const count = server.requests.length;
  await app.connected(CONFIG);
  await settle();
  assert.ok(gladys.fake.requests.filter((r) => r.path === '/discovered_device').length > published);
  assert.match(message(gladys).en, /Too many requests/);
  await advance(MINUTE, 30 * SECOND);
  assert.equal(server.requests.length, count, 'the pause holds');
});

test('air conditioners: absent and refused while the option is off', async (t) => {
  const { gladys, app } = await setup(t);
  assert.ok(!gladys.fake.discoveredDevices.some((d) => d.external_id === device(SAIDS.aircon)));
  await assert.rejects(
    app.setValue({}, { external_id: feature(SAIDS.aircon, 'power-on') }, 1),
    /off in the configuration/,
  );
});

test('air conditioners behind the option: state, buttons, setpoint, mode', async (t) => {
  const { gladys, server, set, advance } = await setup(t, {
    config: { ...CONFIG, enable_aircon: true },
  });
  const ac = gladys.fake.discoveredDevices.find((d) => d.external_id === device(SAIDS.aircon));
  const byKey = Object.fromEntries(ac.features.map((f) => [f.external_id.split(':').pop(), f]));
  assert.deepEqual(Object.keys(byKey).sort(), [
    'humidity',
    'mode',
    'power',
    'power-off',
    'power-on',
    'target',
    'temperature',
  ]);
  assert.equal(byKey.power.read_only, true, 'the on/off is a state, never a switch');
  assert.equal(byKey['power-on'].category, 'button');
  assert.equal(byKey.target.min, 16);
  assert.equal(byKey.target.max, 30);
  assert.deepEqual(
    byKey.mode.supported_options.map((o) => o.value),
    [0, 1, 2, 4],
  );
  assert.equal(last(gladys, SAIDS.aircon, 'power'), 0);
  assert.equal(last(gladys, SAIDS.aircon, 'mode'), 2);
  assert.equal(last(gladys, SAIDS.aircon, 'target'), 30);
  assert.equal(last(gladys, SAIDS.aircon, 'temperature'), 23);
  assert.equal(last(gladys, SAIDS.aircon, 'humidity'), 56);

  let ack = await set(SAIDS.aircon, 'power-on', 1);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.commands().at(-1).json, {
    body: { Sys_OpSetPowerOn: '1' },
    header: { said: SAIDS.aircon, command: 'setAttributes' },
  });
  assert.equal(last(gladys, SAIDS.aircon, 'power'), 1);
  ack = await set(SAIDS.aircon, 'target', 22);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.commands().at(-1).json.body, { Sys_OpSetTargetTemp: '220' });
  ack = await set(SAIDS.aircon, 'mode', 1);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.commands().at(-1).json.body, { Cavity_OpSetMode: '1' });
  ack = await set(SAIDS.aircon, 'mode', 0);
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(server.commands().at(-1).json.body, { Cavity_OpSetMode: '4' });
  const sent = server.commands().length;
  for (const [key, value] of [
    ['target', 35],
    ['target', 10],
    ['mode', 3],
    ['power-off', 0],
  ]) {
    ack = await set(SAIDS.aircon, key, value);
    assert.equal(ack.success, false, `${key}=${value} refused`);
  }
  assert.equal(server.commands().length, sent, 'nothing sent for a refused value');
  await advance(10 * SECOND, SECOND);
  assert.equal(last(gladys, SAIDS.aircon, 'power'), 1, 'read back from the cloud');
});

test('a command without an answer is reported sent without confirmation, then read again', async (t) => {
  const { server, set, advance } = await setup(t, {
    config: { ...CONFIG, enable_aircon: true },
  });
  server.before = (r) => {
    if (r.path === '/api/v1/appliance/command') {
      server.before = undefined;
      throw new WhirlpoolError('timeout', 'no answer within 4 s');
    }
  };
  const reads = server.reads(SAIDS.aircon).length;
  const ack = await set(SAIDS.aircon, 'power-off', 1);
  assert.equal(ack.success, false);
  assert.match(ack.error, /without confirmation/);
  await advance(6 * SECOND, SECOND);
  assert.ok(server.reads(SAIDS.aircon).length > reads, 'read again within seconds');
});

test('a command never signs in with the password; the next cycle does', async (t) => {
  const { app, server, set, advance, gladys } = await setup(t, {
    config: { ...CONFIG, enable_aircon: true },
  });
  // The token has just ended and its refresh token is refused.
  server.revokeRefresh();
  app.client.tokens.expiresAt = Date.now();
  const sent = server.commands().length;
  const ack = await set(SAIDS.aircon, 'target', 21);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Not connected/);
  assert.equal(server.commands().length, sent, 'nothing sent');
  assert.equal(server.tokenCalls('password').length, 1, 'never a password from a command');
  await advance(2 * SECOND, SECOND);
  assert.equal(server.tokenCalls('password').length, 2, 'the cycle signs in again');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
test('the US region and the Maytag app', async (t) => {
  const server = fakeWhirlpool({ host: 'api.whrcloud.com' });
  const { gladys } = await setup(t, {
    server,
    config: { ...CONFIG, brand: 'maytag', region: 'us' },
    create: false,
  });
  assert.equal(server.requests[0].form.client_id, 'maytag_android_v2');
  assert.equal(
    server.of('/api/v1/share-accounts/appliances')[0].headers['WP-CLIENT-BRAND'],
    'Maytag',
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
});
