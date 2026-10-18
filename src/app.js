// -----------------------------------------------------------------------------
// The integration: the Whirlpool account (e-mail, password, brand, region),
// its token renewed by a timer ahead of its end, one read of every supported
// appliance per cycle (the appliance lists every 30 minutes), the Gladys
// devices and their states, the "cycle finished" scene trigger, the air
// conditioner commands (behind an option, one at a time per appliance,
// refused before they are sent when they cannot finish within Gladys' 5 s),
// the transport badges and the test button. index.js only wires the SDK
// handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { WhirlpoolClient } from './client.js';
import { normalizeConfig } from './config.js';
import { LIMITS, SCENE_TRIGGERS, TIMINGS } from './constants.js';
import { buildDevice, deviceIds, deviceStates, planOf } from './devices.js';
import { WhirlpoolError, errorReason } from './http.js';
import { COMMAND, CYCLE_LABELS, KIND_LABELS, T, age, join, word } from './i18n.js';
import { ACTIVE_STATES, kindOf, readingOf } from './model.js';
import { StatePublisher } from './publisher.js';
import { fileStore, fingerprint, newSalt, normalizeMemory } from './store.js';

/** Errors the cloud did not answer usefully for: the account is unreachable. */
const OFFLINE = new Set(['network', 'timeout', 'unavailable', 'bad_response', 'size', 'http']);
/** Errors that stop the polling until the user acts (configuration, button). */
const STOPS = {
  refused: T.refused,
  no_credentials: T.noCredentials,
  no_client: T.noClient,
  locked: T.locked,
  login_rejected: T.loginRejected,
};
/** The stops kept in /data. */
const PERSISTED = new Set(['refused', 'locked', 'login_rejected', 'session_refused']);
/** Errors of one appliance's read that are the account's, not the appliance's: the cycle stops. */
const ACCOUNT_ERRORS = new Set([
  'refused',
  'no_credentials',
  'no_client',
  'locked',
  'login_rejected',
  'session_refused',
  'expired',
  'rate_limited',
]);
/** The fields of a Gladys feature that a publication carries. */
const FEATURE_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'step',
  'read_only',
  'has_feedback',
  'keep_history',
  'supported_options',
];
/** The feature keys a command's `expect` names. */
const EXPECTED_FEATURES = { power: 'power', mode: 'mode', target: 'target' };

const commandError = (message) => new Error(message);

export class WhirlpoolApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'whirlpool' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new WhirlpoolClient({ transport, now, onChange: () => this.tokensChanged() });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** Every device published in this run, by external id: a publication never shrinks. */
    this.known = new Map();
    this.timer = undefined;
    this.refreshTimer = undefined;
    this.refreshFailures = 0;
    this.running = undefined;
    this.generation = 0;
    this.started = false;
    this.lastStatus = undefined;
    this.lastTestAt = -Infinity;
    this.reset();
  }

  /** Forgets the account and the failures: a new account, or a restart. A 429 pause stays. */
  reset() {
    /** SAID -> appliance of the lists (src/client.js), with its `kind`. */
    this.appliances = new Map();
    this.listAt = -Infinity;
    /** SAID -> { attrs, reading, plan, ok } of the last read. */
    this.readings = new Map();
    /** feature external id -> { said, spec } */
    this.writers = new Map();
    /** feature external id -> { expected, until }: a commanded value the read has not confirmed. */
    this.holds = new Map();
    /** SAID -> the tail of its command queue. */
    this.queues = new Map();
    /** SAID -> the laundry state last seen (the cycle end trigger). */
    this.laundryStates = new Map();
    this.soonAt = undefined;
    this.published = undefined;
    this.badges = new Map();
    /** undefined | 'refused' | 'no_client' | 'locked' | 'login_rejected' | 'session_refused' */
    this.blocked = undefined;
    this.sessionRetries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    this.refreshFailures = 0;
    if (this.pauseKind !== 'rate' || this.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
    }
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    if (!this.memory.salt) {
      this.memory.salt = newSalt();
      await this.saveMemory();
    }
    // A 429 pause survives a restart and a change of account.
    if (this.memory.rateLimitedUntil > Math.max(this.now(), this.pausedUntil)) {
      this.pausedUntil = this.memory.rateLimitedUntil;
      this.pauseKind = 'rate';
    }
    const { email, password, brand, region, client, account } = this.config;
    const session = this.memory.session?.account === account ? this.memory.session : null;
    this.client.configure({
      email,
      password,
      brand,
      region,
      client,
      tokens: session
        ? { access: null, refresh: session.refresh, expiresAt: 0, issuedAt: 0 }
        : null,
      accountId: session?.accountId,
    });
    this.publisher.start();
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    if (!client) {
      this.blocked = 'no_client';
      await this.setStatus(false, T.noClient);
      return;
    }
    // A stop on these very credentials survives a restart (never retried by itself).
    const block = this.memory.block;
    if (block && block.fingerprint === this.fingerprint) {
      this.blocked = block.kind;
      this.retryAt = block.retryAt ?? 0;
      this.sessionRetries = block.retries;
      if (block.kind !== 'session_refused') {
        await this.setStatus(false, STOPS[block.kind]);
        return;
      }
    }
    const waiting =
      this.blocked === 'session_refused' && this.retryAt > this.now()
        ? T.sessionRefused(age(this.retryAt - this.now()))
        : undefined;
    await this.setStatus(false, waiting ?? this.pauseMessage() ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.clearRefreshTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  clearRefreshTimer() {
    if (this.refreshTimer) {
      this.timers.clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
  }

  get fingerprint() {
    return fingerprint(this.memory.salt ?? '', this.config.account, this.config.password);
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges). The pauses, the stops and the tokens stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges = new Map();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishBadges();
  }

  /** A new account restarts; a new interval reschedules; the air conditioner option re-reads. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (['email', 'password', 'brand', 'region'].some((key) => next[key] !== previous[key])) {
      return this.start(raw);
    }
    this.config = next;
    if (next.enableAircon !== previous.enableAircon) {
      this.rebuild();
      if (!this.blocked && this.timer) {
        this.scheduleNext(0);
      }
    }
    if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.scheduleNext();
    }
    if (next.language !== previous.language) {
      await this.publishDevices();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  /** The tokens changed: keep the refresh token in /data, and time the next renewal. */
  async tokensChanged() {
    this.scheduleRefresh();
    const { account } = this.config;
    const { tokens, accountId } = this.client;
    const session = tokens?.refresh ? { account, refresh: tokens.refresh, accountId } : null;
    if (JSON.stringify(session) === JSON.stringify(this.memory.session)) {
      return;
    }
    this.memory.session = session;
    await this.saveMemory();
  }

  /** Keeps the current stop (or none) in /data, tied to the credentials. */
  async saveBlock() {
    const kind = PERSISTED.has(this.blocked) ? this.blocked : undefined;
    const block = kind
      ? {
          kind,
          fingerprint: this.fingerprint,
          retryAt: kind === 'session_refused' ? this.retryAt : undefined,
          retries: this.sessionRetries,
        }
      : null;
    if (JSON.stringify(block) !== JSON.stringify(this.memory.block ?? null)) {
      this.memory.block = block;
      await this.saveMemory();
    }
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Token renewal by timer ---------------------------------------------------

  /**
   * The token is renewed ahead of its end (10 minutes, or half its lifetime
   * when shorter), so a read or a command never waits for a renewal. A
   * restarted integration has no access token: its first cycle renews it.
   */
  scheduleRefresh(delay) {
    this.clearRefreshTimer();
    const tokens = this.client.tokens;
    if (!tokens?.access || !tokens.refresh) {
      return;
    }
    if (delay === undefined) {
      const lifetime = Math.max(0, tokens.expiresAt - tokens.issuedAt);
      const at = tokens.expiresAt - Math.min(TIMINGS.refreshAhead, lifetime / 2);
      delay = Math.max(TIMINGS.refreshMinimum, at - this.now());
    }
    const generation = this.generation;
    this.refreshTimer = this.timers.setTimeout(() => {
      this.refreshTimer = undefined;
      if (generation === this.generation) {
        this.renew().catch((err) => this.logger.warn(`Token renewal failed: ${errorReason(err)}`));
      }
    }, delay);
  }

  async renew() {
    if (this.blocked || (this.pauseKind === 'rate' && this.now() < this.pausedUntil)) {
      // Stopped or paused: the cycle that resumes renews the token when it needs it.
      return;
    }
    try {
      await this.client.refresh();
      this.refreshFailures = 0;
    } catch (err) {
      if (err.kind === 'token_refused') {
        // The next cycle signs in again once (or stops if that is refused).
        this.logger.warn('Whirlpool refused the refresh token');
        return;
      }
      if (err.kind === 'rate_limited') {
        await this.pause(err);
        await this.setStatus(this.connectedOnce, T.rateLimited(age(this.pausedUntil - this.now())));
        return;
      }
      if (err.kind === 'locked') {
        await this.failed(err);
        return;
      }
      const wait =
        TIMINGS.refreshRetry[Math.min(this.refreshFailures, TIMINGS.refreshRetry.length - 1)];
      this.refreshFailures += 1;
      this.logger.warn(`Token renewal failed: ${errorReason(err)}; next try in ${wait / 1000} s`);
      this.scheduleRefresh(wait);
    }
  }

  // --- Polling ---------------------------------------------------------------

  /** `soon`: read again after this delay (a command to confirm), unless stopped or paused. */
  scheduleNext(soon) {
    this.clearTimer();
    if (!this.client.hasCredentials || !this.config.client) {
      return;
    }
    const now = this.now();
    if (soon !== undefined) {
      this.soonAt = Math.min(this.soonAt ?? Infinity, now + soon);
    }
    if (this.soonAt !== undefined) {
      soon = Math.max(0, this.soonAt - now);
    }
    let delay;
    if (this.blocked === 'session_refused') {
      delay = Math.max(this.retryAt, this.pausedUntil) - now;
    } else if (this.blocked) {
      return;
    } else if (now < this.pausedUntil) {
      delay = this.pausedUntil - now;
    } else {
      delay = Math.min(soon ?? Infinity, this.config.pollInterval * 1000);
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`Whirlpool refresh failed: ${err.message}`));
        }
      },
      Math.max(0, delay),
    );
  }

  /** One run at a time: a tick during a run joins it. `quick`: for the button. */
  tick({ quick = false } = {}) {
    if (!this.running) {
      this.running = this.run({ quick }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  /** The appliances read at each cycle: the supported ones (air conditioners behind the option). */
  get readable() {
    return [...this.appliances.values()].filter(
      (a) => a.kind && (a.kind !== 'aircon' || this.config.enableAircon),
    );
  }

  async run({ quick = false } = {}) {
    const generation = this.generation;
    const now = this.now();
    if (!this.client.hasCredentials || !this.config.client) {
      return;
    }
    if (this.blocked === 'session_refused' && now >= this.retryAt) {
      this.logger.info('Whirlpool: trying the session again');
      this.blocked = undefined;
    }
    if (this.blocked || now < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    this.client.beginCycle();
    this.client.timeout = quick ? TIMINGS.quickTimeout : undefined;
    if (this.soonAt !== undefined && this.soonAt <= now) {
      this.soonAt = undefined;
    }
    try {
      if (now - this.listAt >= TIMINGS.listInterval || this.appliances.size === 0) {
        const list = await this.client.appliances({ allowLogin: true });
        if (generation !== this.generation) {
          return;
        }
        this.setAppliances(list);
        this.listAt = now;
      }
      await this.readAll(generation);
      if (generation !== this.generation) {
        return;
      }
      this.failures = 0;
      this.sessionRetries = 0;
      this.offline = false;
      this.connectedOnce = true;
      if (this.pauseKind !== 'rate') {
        this.pauseKind = undefined;
      }
      await this.saveBlock();
      await this.setStatus(true, T.connected(this.appliances.size, this.readable.length));
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    } finally {
      this.client.timeout = undefined;
    }
    await this.publishDevices();
    await this.publishBadges();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  setAppliances(list) {
    const appliances = new Map();
    for (const appliance of list.slice(0, LIMITS.appliances)) {
      appliances.set(appliance.said, { ...appliance, kind: kindOf(appliance.dataModel) });
    }
    // An appliance missing from a list keeps its device (and is shown unreachable).
    for (const [said, appliance] of this.appliances) {
      if (!appliances.has(said) && this.readings.has(said)) {
        appliances.set(said, { ...appliance, missing: true });
      }
    }
    this.appliances = appliances;
  }

  /**
   * One read per appliance. The error of one appliance (a 404, a bad
   * answer) never hides the others; an error of the account (session, 429)
   * stops the cycle; when every read failed, the cycle failed.
   */
  async readAll(generation) {
    const targets = this.readable.filter((a) => !a.missing);
    let failed;
    let read = 0;
    for (const appliance of targets) {
      try {
        const attrs = await this.client.data(appliance.said, { allowLogin: true });
        if (generation !== this.generation) {
          return;
        }
        this.applyReading(appliance, attrs);
        read += 1;
      } catch (err) {
        if (ACCOUNT_ERRORS.has(err.kind) || !(err instanceof WhirlpoolError)) {
          throw err;
        }
        failed = failed ?? err;
        const previous = this.readings.get(appliance.said);
        if (previous) {
          previous.ok = false;
        }
        this.logger.warn(`Whirlpool: reading an appliance failed: ${errorReason(err)}`);
      }
    }
    this.rebuild();
    if (failed && read === 0) {
      throw failed;
    }
  }

  applyReading(appliance, attrs) {
    const created = this.createdDevices().get(deviceIds(this.gladys, appliance.said).device);
    const plan = planOf(appliance, attrs, created);
    const reading = readingOf(appliance.kind, attrs);
    this.readings.set(appliance.said, { attrs, reading, plan, ok: true });
    this.queueStates(appliance.said);
    if (appliance.kind === 'washer' || appliance.kind === 'dryer') {
      this.cycleEnd(appliance, reading);
    }
  }

  /** The writers of the last reads (the air conditioners, when allowed). */
  rebuild() {
    this.writers = new Map();
    if (!this.config.enableAircon) {
      return;
    }
    for (const [said, { plan }] of this.readings) {
      if (plan?.kind !== 'aircon') {
        continue;
      }
      const ids = deviceIds(this.gladys, said);
      for (const spec of plan.specs) {
        if (spec.write) {
          this.writers.set(ids.feature(spec.key), { said, spec });
        }
      }
    }
  }

  /** A 429: a pause of every path, kept in /data. */
  async pause(err) {
    const wait = Math.min(
      TIMINGS.rateLimitMax,
      Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
    );
    this.pauseKind = 'rate';
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.memory.rateLimitedUntil = this.pausedUntil;
    await this.saveMemory();
    return wait;
  }

  async failed(err) {
    const reason = errorReason(err);
    if (STOPS[err.kind]) {
      // Never signed in again by itself: refusals may lock the account.
      this.blocked = err.kind === 'no_credentials' ? 'refused' : err.kind;
      this.clearTimer();
      this.clearRefreshTimer();
      await this.saveBlock();
      this.logger.warn(`Whirlpool stopped: ${reason}`);
      await this.setStatus(false, STOPS[err.kind]);
      return;
    }
    if (err.kind === 'session_refused' || err.kind === 'expired') {
      const wait =
        TIMINGS.sessionRetry[Math.min(this.sessionRetries, TIMINGS.sessionRetry.length - 1)];
      this.sessionRetries += 1;
      this.blocked = 'session_refused';
      this.retryAt = this.now() + wait;
      await this.saveBlock();
      this.logger.warn(`Whirlpool: ${reason}; one new try in ${Math.round(wait / 60_000)} min`);
      await this.setStatus(false, T.sessionRefused(age(wait)));
      return;
    }
    let wait;
    let message;
    if (err.kind === 'rate_limited') {
      wait = await this.pause(err);
      message = T.rateLimited(age(wait));
    } else {
      // Never read again sooner than the interval.
      wait = Math.max(
        this.config.pollInterval * 1000,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = 'backoff';
      this.offline = OFFLINE.has(err.kind) || this.offline;
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      message = T.unreachable(reason, age(wait));
    }
    this.failures += 1;
    await this.setStatus(err.kind === 'rate_limited' && this.connectedOnce, message);
    this.logger.warn(`Whirlpool: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  // --- Scene trigger -------------------------------------------------------------

  /** One event per cycle end: a washer or dryer going from a cycle to "complete". */
  cycleEnd(appliance, reading) {
    const previous = this.laundryStates.get(appliance.said);
    if (reading.state === null) {
      return;
    }
    this.laundryStates.set(appliance.said, reading.state);
    if (reading.state !== 'complete' || !previous || !ACTIVE_STATES.has(previous)) {
      return;
    }
    const deviceId = deviceIds(this.gladys, appliance.said).device;
    const created = this.createdDevices().has(deviceId);
    const language = this.config.language;
    const cycle = reading.cycle?.name
      ? reading.cycle.name
      : reading.cycle?.key
        ? word(CYCLE_LABELS[reading.cycle.key], language)
        : reading.cycle
          ? word(CYCLE_LABELS.number(reading.cycle.number), language)
          : '';
    this.logger.info(`Whirlpool: a ${appliance.kind} cycle finished`);
    this.gladys
      .publishSceneEvent(SCENE_TRIGGERS.CYCLE_FINISHED, {
        appliance: created ? deviceId : '',
        appliance_name: appliance.name,
        kind: appliance.kind,
        kind_label: word(KIND_LABELS[appliance.kind], language),
        cycle: cycle.slice(0, LIMITS.text),
      })
      .catch((err) => this.logger.warn(`Scene event failed: ${err.message}`));
  }

  // --- Gladys ----------------------------------------------------------------

  createdDevices() {
    return new Map((this.gladys.devices ?? []).map((d) => [d.external_id, d]));
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  /**
   * The devices of the last reads, merged so that nothing ever disappears: a
   * created device keeps its features as Gladys has them (types and units
   * are fixed at creation), plus any new one; a device or a feature seen
   * earlier in this run stays published.
   */
  async publishDevices() {
    const created = this.createdDevices();
    for (const [said, { plan }] of this.readings) {
      const appliance = this.appliances.get(said);
      if (!appliance || !plan) {
        continue;
      }
      const fresh = buildDevice(this.gladys, appliance, plan, this.config.language);
      const previous = this.known.get(fresh.external_id);
      const mine = created.get(fresh.external_id);
      const features = new Map();
      for (const f of mine?.features ?? []) {
        features.set(
          f.external_id,
          Object.fromEntries(
            FEATURE_FIELDS.filter((k) => f[k] !== undefined && f[k] !== null).map((k) => [k, f[k]]),
          ),
        );
      }
      for (const f of [...(previous?.features ?? []), ...fresh.features]) {
        if (!features.has(f.external_id)) {
          features.set(f.external_id, f);
        }
      }
      if (!previous && this.known.size >= LIMITS.appliances) {
        continue;
      }
      this.known.set(fresh.external_id, { ...fresh, features: [...features.values()] });
    }
    const list = [...this.known.values()];
    const json = JSON.stringify(list);
    if (list.length === 0 || json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(list);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** A commanded value waiting for its confirmation hides an older read. */
  held(featureId, value) {
    const hold = this.holds.get(featureId);
    if (!hold) {
      return false;
    }
    if (this.now() >= hold.until || JSON.stringify(value) === hold.expected) {
      this.holds.delete(featureId);
      return false;
    }
    return true;
  }

  queueStates(only, created = this.createdFeatures()) {
    for (const [said, entry] of this.readings) {
      if (only && said !== only) {
        continue;
      }
      const appliance = this.appliances.get(said);
      if (!appliance || !entry.plan) {
        continue;
      }
      for (const { id, value } of deviceStates(
        this.gladys,
        appliance,
        entry.plan,
        entry.reading,
        this.config.language,
      )) {
        if (created.has(id) && !this.held(id, value)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  /** The appliance can be reached for Gladys: read in the last cycle and online. */
  reachable(said) {
    const appliance = this.appliances.get(said);
    const entry = this.readings.get(said);
    if (!appliance || appliance.missing || !entry?.ok) {
      return false;
    }
    if (appliance.kind === 'aircon' && !this.config.enableAircon) {
      return false;
    }
    return entry.reading?.online !== false;
  }

  /** One badge per created device: cloud, or unreachable (stopped, offline, appliance offline). */
  async publishBadges() {
    const entries = [];
    const saids = new Map(
      [...this.appliances.keys()].map((said) => [deviceIds(this.gladys, said).device, said]),
    );
    for (const device of this.gladys.devices ?? []) {
      if (!this.known.has(device.external_id)) {
        continue;
      }
      const said = saids.get(device.external_id);
      const unreachable = this.blocked || this.offline || !said || !this.reachable(said);
      const transport = unreachable ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
      if (this.badges.get(device.external_id) !== transport) {
        entries.push({ external_id: device.external_id, transport });
      }
    }
    for (let i = 0; i < entries.length; i += 100) {
      const batch = entries.slice(i, i + 100);
      try {
        await this.gladys.publishTransports(batch);
        for (const entry of batch) {
          this.badges.set(entry.external_id, entry.transport);
        }
      } catch (err) {
        this.logger.warn(`Transport badges failed: ${err.message}`);
      }
    }
  }

  async deviceCreated(device) {
    if (device?.external_id) {
      this.badges.delete(device.external_id);
    }
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(undefined, created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    if (device?.external_id) {
      this.badges.delete(device.external_id);
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the devices of the last read; the lists are read at the next cycle. */
  async scan() {
    this.listAt = -Infinity;
    this.published = undefined;
    await this.publishDevices();
  }

  // --- Commands (air conditioners) ---------------------------------------------

  async setValue(device, feature, value) {
    const featureId = feature?.external_id;
    if (!this.config.enableAircon) {
      throw commandError(COMMAND.airconOff);
    }
    const writer = this.writers.get(featureId);
    if (!writer) {
      throw commandError(COMMAND.unknown);
    }
    const { said, spec } = writer;
    const result = spec.write(value);
    if (result.refuse) {
      throw commandError(COMMAND[result.refuse]);
    }
    if (this.blocked || !this.client.hasCredentials) {
      throw commandError(COMMAND.blocked);
    }
    if (this.pauseKind === 'rate' && this.now() < this.pausedUntil) {
      throw commandError(COMMAND.paused);
    }
    const deadline = this.now() + TIMINGS.commandBudget;
    return this.serial(said, () => this.command(said, result, deadline));
  }

  /** One command at a time per appliance; each waits for the previous one. */
  serial(said, job) {
    const previous = this.queues.get(said) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(job);
    this.queues.set(said, run);
    run
      .finally(() => {
        if (this.queues.get(said) === run) {
          this.queues.delete(said);
        }
      })
      .catch(() => {});
    return run;
  }

  async command(said, { attributes, expect }, deadline) {
    if (deadline - this.now() < TIMINGS.commandMinimum) {
      throw commandError(COMMAND.late);
    }
    const entry = this.readings.get(said);
    if (!entry) {
      throw commandError(COMMAND.unknown);
    }
    if (entry.reading?.online === false) {
      throw commandError(COMMAND.offline);
    }
    try {
      await this.client.command(said, attributes, { deadline });
    } catch (err) {
      throw await this.commandFailure(err);
    }
    this.confirm(said, expect);
  }

  /** Accepted: the expected values are shown at once, held against an older read, and read again soon. */
  confirm(said, expect) {
    const entry = this.readings.get(said);
    if (entry?.reading) {
      entry.reading = { ...entry.reading, ...expect };
      const ids = deviceIds(this.gladys, said);
      const until = this.now() + TIMINGS.commandHold;
      const appliance = this.appliances.get(said);
      const expected = new Set(Object.keys(expect).map((k) => ids.feature(EXPECTED_FEATURES[k])));
      for (const { id, value } of deviceStates(
        this.gladys,
        appliance,
        entry.plan,
        entry.reading,
        this.config.language,
      )) {
        if (expected.has(id)) {
          this.holds.delete(id);
          if (this.createdFeatures().has(id)) {
            this.publisher.push(id, value);
          }
          this.holds.set(id, { expected: JSON.stringify(value), until });
        }
      }
      this.flush();
    }
    this.scheduleNext(TIMINGS.confirmRead);
  }

  async commandFailure(err) {
    if (!(err instanceof WhirlpoolError)) {
      return err;
    }
    if (err.sent) {
      // The command left without an answer: it may have been done. Read soon.
      this.logger.warn(`Whirlpool command sent without confirmation: ${errorReason(err)}`);
      this.scheduleNext(TIMINGS.confirmRead);
      return commandError(COMMAND.unconfirmed);
    }
    this.logger.warn(`Whirlpool command not done: ${errorReason(err)}`);
    switch (err.kind) {
      case 'rate_limited':
        await this.pause(err);
        await this.setStatus(this.connectedOnce, T.rateLimited(age(this.pausedUntil - this.now())));
        return commandError(COMMAND.paused);
      case 'invalid_command':
        return commandError(COMMAND.refused);
      case 'late':
      case 'timeout':
        return commandError(COMMAND.late);
      case 'unauthorized':
      case 'session_refused':
      case 'token_refused':
      case 'expired':
        // The next cycle renews the session (never a password from a command).
        this.scheduleNext(0);
        return commandError(COMMAND.blocked);
      default:
        return commandError(`Whirlpool: ${errorReason(err)}`);
    }
  }

  // --- Configuration button --------------------------------------------------------

  /** A 429 pause holds for every path, the button included. */
  pauseMessage() {
    const left = this.pausedUntil - this.now();
    return left > 0 && this.pauseKind === 'rate' ? T.rateLimited(age(left)) : undefined;
  }

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    if (!this.config.client) {
      return T.noClient;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.lastMessage;
      return last ? join(T.test.cooldown, last) : T.test.cooldown;
    }
    if (this.running) {
      return T.busy;
    }
    this.lastTestAt = this.now();
    // One read per click: the button is how a stopped account is retried.
    this.blocked = undefined;
    this.sessionRetries = 0;
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    this.listAt = -Infinity;
    await this.saveBlock();
    await this.tick({ quick: true });
    return this.lastMessage ?? T.noCredentials;
  }
}
