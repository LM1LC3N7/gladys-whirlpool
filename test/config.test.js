// -----------------------------------------------------------------------------
// The configuration, normalized; the client of the token calls; the /data
// state, repaired.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountKey, normalizeConfig } from '../src/config.js';
import { CLIENTS, TIMINGS } from '../src/constants.js';
import { WhirlpoolClient, applianceOf, tokensOf } from '../src/client.js';
import { normalizeMemory } from '../src/store.js';

test('defaults, bounds, options only on a real true', () => {
  const c = normalizeConfig({});
  assert.equal(c.brand, 'whirlpool');
  assert.equal(c.region, 'eu');
  assert.equal(c.pollInterval, 60);
  assert.equal(c.enableAircon, false);
  assert.equal(c.language, 'fr');
  assert.equal(c.account, '');
  assert.equal(normalizeConfig({ poll_interval: 5 }).pollInterval, 60);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).pollInterval, 900);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, 60);
  assert.equal(normalizeConfig({ enable_aircon: 'yes' }).enableAircon, false);
  assert.equal(normalizeConfig({ enable_aircon: 'true' }).enableAircon, true);
  assert.equal(normalizeConfig({ brand: 'Consul' }).brand, 'whirlpool');
  assert.equal(normalizeConfig({ region: 'US' }).region, 'us');
});

test('the client of each brand and region; none for Maytag in Europe', () => {
  assert.equal(normalizeConfig({ brand: 'kitchenaid' }).client, CLIENTS.eu.kitchenaid);
  assert.equal(normalizeConfig({ brand: 'maytag', region: 'us' }).client.id, 'maytag_android_v2');
  assert.equal(normalizeConfig({ brand: 'maytag', region: 'eu' }).client, undefined);
});

test('the account key is a hash, not the e-mail, and depends on brand and region', () => {
  const key = accountKey('whirlpool', 'eu', ' Someone@Example.com ');
  assert.match(key, /^[0-9a-f]{16}$/);
  assert.equal(key, accountKey('whirlpool', 'eu', 'someone@example.com'));
  assert.notEqual(key, accountKey('kitchenaid', 'eu', 'someone@example.com'));
});

test('token answers: lifetime, account id, refresh token kept when not sent', () => {
  const now = 1000;
  const a = tokensOf({ access_token: 'a', refresh_token: 'r', expires_in: 100, accountId: 7 }, now);
  assert.deepEqual(a, {
    tokens: { access: 'a', refresh: 'r', expiresAt: now + 100_000, issuedAt: now },
    accountId: '7',
  });
  const b = tokensOf({ access_token: 'b' }, now, a.tokens);
  assert.equal(b.tokens.refresh, 'r');
  assert.equal(b.tokens.expiresAt, now + TIMINGS.tokenDefault);
  assert.throws(() => tokensOf({}, now), { kind: 'bad_response' });
});

test('appliances without a usable SAID are dropped', () => {
  assert.equal(applianceOf({ SAID: '../x' }), undefined);
  assert.equal(applianceOf({}), undefined);
  assert.deepEqual(applianceOf({ SAID: 'A1', DATA_MODEL_KEY: 'X_WASHER' }, true), {
    said: 'A1',
    name: 'A1',
    category: '',
    model: '',
    serial: '',
    dataModel: 'x_washer',
    shared: true,
  });
});

test('a command with too little time left is never sent', async () => {
  let calls = 0;
  const now = () => 10_000;
  const client = new WhirlpoolClient({ transport: async () => (calls += 1), now });
  client.configure({
    email: 'e',
    password: 'p',
    brand: 'whirlpool',
    region: 'eu',
    client: CLIENTS.eu.whirlpool,
    tokens: { access: 'a', refresh: 'r', expiresAt: 10_000_000, issuedAt: 0 },
    accountId: '1',
  });
  await assert.rejects(client.command('S1', { x: '1' }, { deadline: 11_000 }), (err) => {
    assert.equal(err.kind, 'late');
    assert.equal(err.sent, false);
    return true;
  });
  assert.equal(calls, 0);
});

test('the /data state is repaired and its pauses capped', () => {
  const now = 1_000_000;
  const m = normalizeMemory(
    {
      salt: 'nope',
      session: { account: 'x', refresh: 'r' },
      rateLimitedUntil: now + 100 * TIMINGS.rateLimitMax,
      block: { kind: 'other', fingerprint: '0123456789abcdef' },
    },
    now,
  );
  assert.equal(m.salt, null);
  assert.equal(m.session, null);
  assert.equal(m.rateLimitedUntil, now + TIMINGS.rateLimitMax);
  assert.equal(m.block, null);
  const ok = normalizeMemory({
    session: { account: '0123456789abcdef', refresh: 'r', accountId: '12' },
    block: { kind: 'locked', fingerprint: '0123456789abcdef', retries: 99 },
  });
  assert.deepEqual(ok.session, { account: '0123456789abcdef', refresh: 'r', accountId: '12' });
  assert.equal(ok.block.kind, 'locked');
  assert.equal(ok.block.retries, 10);
});
