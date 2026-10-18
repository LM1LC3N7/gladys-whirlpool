// -----------------------------------------------------------------------------
// The Whirlpool account: the sign-in (OAuth password grant with the client of
// the brand's app), the token renewed with the refresh token, and the five
// calls the integration needs (account id, owned and shared appliances, the
// attributes of one appliance, a command). Ported from whirlpool-sixth-sense
// (MIT): auth.py, backendselector.py, httpapi/appliancesmanager.py and
// httpapi/appliance.py. Every request goes through the transport of
// src/http.js.
// -----------------------------------------------------------------------------

import { BRAND_HEADER, HOSTS, LIMITS, PATHS, TIMINGS, USER_AGENT } from './constants.js';
import {
  WhirlpoolError,
  httpRequest,
  isAccountError,
  parseJson,
  transientError,
  tryJson,
} from './http.js';

/** A SAID or an account id as the integration accepts them. */
export const ID = /^[A-Za-z0-9_.-]{1,64}$/;

/** The errors of the shared list that are ignored (sharing is not offered everywhere). */
const SHARED_IGNORED = new Set(['http', 'bad_response', 'size', 'unavailable', 'network']);

const text = (value, max = 256) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).slice(0, max) : '';

/** Marks an error of the token endpoint: the account's, it stops the cycle. */
const authError = (err) => {
  if (err instanceof WhirlpoolError) {
    err.auth = true;
  }
  return err;
};

/** One appliance of a list answer, or undefined when it has no usable SAID. */
export function applianceOf(raw, shared = false) {
  // The whole value is checked: a longer SAID is not cut into another one.
  const said = text(raw?.SAID, 1000);
  if (!ID.test(said)) {
    return undefined;
  }
  return {
    said,
    name: text(raw.APPLIANCE_NAME, 100).trim() || said,
    category: text(raw.CATEGORY_NAME, 64),
    model: text(raw.MODEL_NO, 64),
    serial: text(raw.SERIAL, 64),
    dataModel: text(raw.DATA_MODEL_KEY, 128).toLowerCase(),
    shared,
  };
}

/** The tokens of a token answer, the previous refresh token kept when none is sent. */
export function tokensOf(json, now, previous) {
  const access = json?.access_token;
  if (typeof access !== 'string' || access === '') {
    throw new WhirlpoolError('bad_response', 'Whirlpool sent no access token');
  }
  const refresh =
    typeof json.refresh_token === 'string' && json.refresh_token !== ''
      ? json.refresh_token
      : previous?.refresh;
  const seconds = Number(json.expires_in);
  const lifetime = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : TIMINGS.tokenDefault;
  const accountId = text(json.accountId, 64);
  return {
    tokens: { access, refresh: refresh ?? null, expiresAt: now + lifetime, issuedAt: now },
    accountId: ID.test(accountId) ? accountId : undefined,
  };
}

export class WhirlpoolClient {
  constructor({ transport = httpRequest, now = Date.now, onChange } = {}) {
    this.transport = transport;
    this.now = now;
    /** Called after the tokens or the account id changed. */
    this.onChange = onChange;
    this.email = '';
    this.password = '';
    this.brand = 'whirlpool';
    this.region = 'eu';
    this.client = undefined;
    /** { access, refresh, expiresAt, issuedAt } | null; `access` null after a restart. */
    this.tokens = null;
    this.accountId = undefined;
    this.authenticating = undefined;
    /** One password sign-in per cycle at most (beginCycle resets it). */
    this.relogged = false;
    /** Per-request timeout; undefined = the transport's default (shorter for the button). */
    this.timeout = undefined;
  }

  configure({ email, password, brand, region, client, tokens = null, accountId }) {
    this.email = email;
    this.password = password;
    this.brand = brand;
    this.region = region;
    this.client = client;
    this.tokens = tokens?.refresh || tokens?.access ? tokens : null;
    this.accountId = typeof accountId === 'string' && ID.test(accountId) ? accountId : undefined;
    this.relogged = false;
  }

  get hasCredentials() {
    return this.email !== '' && this.password !== '';
  }

  get base() {
    return `https://${HOSTS[this.region] ?? HOSTS.eu}`;
  }

  /** The token is usable for a request now (not ending within the margin). */
  get tokenValid() {
    if (!this.tokens?.access) {
      return false;
    }
    // A short-lived token keeps a quarter of its life as the margin, not 30 s.
    const lifetime = Math.max(0, this.tokens.expiresAt - this.tokens.issuedAt);
    const margin = Math.min(TIMINGS.tokenMargin, lifetime / 4);
    return this.now() < this.tokens.expiresAt - margin;
  }

  beginCycle() {
    this.relogged = false;
  }

  async changed() {
    try {
      await this.onChange?.();
    } catch {
      // Persisting is best effort: the tokens still work in memory.
    }
  }

  options(timeout, maxBytes) {
    const value = timeout ?? this.timeout;
    return { ...(value === undefined ? {} : { timeout: value }), maxBytes };
  }

  /**
   * The timeout of a request made before `deadline` (a command): what is
   * left, or `late` when less than the minimum is (never sent then).
   */
  timeLeft(deadline, timeout) {
    if (deadline === undefined) {
      return timeout;
    }
    const left = deadline - this.now();
    if (left < TIMINGS.commandMinimum) {
      throw new WhirlpoolError('late', 'not enough time left to send the request');
    }
    return Math.min(left, timeout ?? left);
  }

  /** One sign-in step at a time: a job waits for the one in progress, then runs its own. */
  single(job) {
    const run = (this.authenticating ?? Promise.resolve()).catch(() => {}).then(job);
    const tail = run.finally(() => {
      if (this.authenticating === tail) {
        this.authenticating = undefined;
      }
    });
    tail.catch(() => {});
    this.authenticating = tail;
    return run;
  }

  // --- Token endpoint --------------------------------------------------------

  /** POST /oauth/token with the brand's client; the answer, or a WhirlpoolError. */
  async token(form, { timeout } = {}) {
    if (!this.client) {
      throw new WhirlpoolError('no_client', 'this brand has no app in this region');
    }
    const body = new URLSearchParams({
      ...form,
      client_id: this.client.id,
      client_secret: this.client.secret,
    }).toString();
    const answer = await this.transport(`${this.base}${PATHS.token}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      body,
      ...this.options(timeout, LIMITS.authBytes),
    });
    const error = transientError(answer, this.now());
    if (error) {
      throw error;
    }
    if (answer.status === 423) {
      // auth.py AccountLockedError.
      throw new WhirlpoolError('locked', 'the Whirlpool account is locked', { status: 423 });
    }
    const json = tryJson(answer.body);
    if (answer.status === 403 && (!json || typeof json !== 'object')) {
      // Not an answer of the API (a CDN block): transient, not the account.
      throw new WhirlpoolError('unavailable', 'Whirlpool refused the request', { status: 403 });
    }
    return { status: answer.status, json };
  }

  /** Signs in with the e-mail and the password (auth.py, grant_type=password). */
  signIn({ timeout } = {}) {
    if (!this.hasCredentials) {
      return Promise.reject(new WhirlpoolError('no_credentials', 'no e-mail or password'));
    }
    return this.single(() => this.doSignIn(timeout));
  }

  async doSignIn(timeout) {
    const { email, password } = this;
    const { status, json } = await this.token(
      { grant_type: 'password', username: email, password },
      { timeout },
    );
    if (this.email !== email || this.password !== password) {
      throw new WhirlpoolError('network', 'the account changed during the sign-in');
    }
    if ([400, 401, 403].includes(status)) {
      throw new WhirlpoolError('refused', 'e-mail or password refused', { status });
    }
    if (status !== 200) {
      throw new WhirlpoolError('login_rejected', 'unexpected sign-in answer', { status });
    }
    let result;
    try {
      result = tokensOf(json, this.now(), null);
    } catch (err) {
      throw new WhirlpoolError('login_rejected', `unexpected sign-in answer (${err.message})`);
    }
    this.tokens = result.tokens;
    this.accountId = result.accountId ?? this.accountId;
    await this.changed();
    return this.tokens;
  }

  /** Renews the token with the refresh token (auth.py, grant_type=refresh_token). */
  refresh({ timeout, deadline } = {}) {
    const before = this.tokens;
    return this.single(async () => {
      const current = this.tokens;
      if (current !== before && current?.access && this.tokenValid) {
        // Renewed while this one waited.
        return current;
      }
      if (!current?.refresh) {
        throw new WhirlpoolError('token_refused', 'no refresh token');
      }
      timeout = this.timeLeft(deadline, timeout);
      const { status, json } = await this.token(
        { grant_type: 'refresh_token', refresh_token: current.refresh },
        { timeout },
      );
      if (status !== 200) {
        if ([400, 401, 403].includes(status) && this.tokens === current) {
          this.tokens = null;
          await this.changed();
          throw new WhirlpoolError('token_refused', 'the refresh token was refused', { status });
        }
        throw new WhirlpoolError('http', 'the token renewal failed', { status });
      }
      const result = tokensOf(json, this.now(), current);
      this.tokens = result.tokens;
      this.accountId = result.accountId ?? this.accountId;
      await this.changed();
      return this.tokens;
    });
  }

  /**
   * A token that is not about to expire. Resolves true when it was obtained
   * now. A refused refresh token falls back to one password sign-in per
   * cycle (as auth.py does), only when `allowLogin`: never from a command.
   */
  async ensureToken({ allowLogin = false, timeout, deadline, force = false } = {}) {
    if (this.authenticating) {
      await this.waitAuthenticating(deadline);
    }
    if (!force && this.tokenValid) {
      return false;
    }
    if (this.tokens?.refresh) {
      try {
        await this.refresh({ timeout, deadline });
        return true;
      } catch (err) {
        if (err.kind !== 'token_refused') {
          // `late` is a command's own budget, not the account's.
          throw err.kind === 'late' ? err : authError(err);
        }
      }
    }
    if (!allowLogin || deadline !== undefined) {
      throw authError(new WhirlpoolError('expired', 'the Whirlpool session expired'));
    }
    if (this.relogged) {
      throw authError(
        new WhirlpoolError('session_refused', 'the session was refused after a new sign-in'),
      );
    }
    this.relogged = true;
    try {
      await this.signIn({ timeout });
    } catch (err) {
      throw authError(err);
    }
    return true;
  }

  /**
   * Waits for the sign-in step in progress; a command waits only within its
   * budget, then is `late` (never sent).
   */
  async waitAuthenticating(deadline) {
    const pending = this.authenticating.catch(() => {});
    if (deadline === undefined) {
      await pending;
      return;
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = setTimeout(
        resolve,
        Math.max(0, deadline - TIMINGS.commandMinimum - this.now()),
        'late',
      );
    });
    try {
      if ((await Promise.race([pending, late])) === 'late') {
        throw new WhirlpoolError('late', 'a sign-in is in progress');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  // --- API -------------------------------------------------------------------

  async apiSend(method, path, { payload, headers = {}, maxBytes, timeout, deadline, guard } = {}) {
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const wait = this.timeLeft(deadline, timeout);
    // A command checks its conditions once more, right before it leaves.
    if (guard && !guard()) {
      throw new WhirlpoolError('cancelled', 'the command is no longer allowed');
    }
    let answer;
    try {
      answer = await this.transport(`${this.base}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.tokens?.access ?? ''}`,
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          Pragma: 'no-cache',
          'Cache-Control': 'no-cache',
          ...(body === undefined ? {} : { 'Content-Length': Buffer.byteLength(body) }),
          ...headers,
        },
        body,
        ...this.options(wait, maxBytes ?? LIMITS.dataBytes),
      });
    } catch (err) {
      // A command without an answer may have reached the appliance.
      if (method === 'POST' && err instanceof WhirlpoolError && err.kind !== 'late') {
        err.sent = true;
      }
      throw err;
    }
    const error = transientError(answer, this.now());
    if (error) {
      // A command answered by a gateway error (502, 504...) may have been
      // done; a 503 says the service did not take it.
      if (method === 'POST' && answer.status >= 500 && answer.status !== 503) {
        error.sent = true;
      }
      throw error;
    }
    if (answer.status === 403) {
      const json = tryJson(answer.body);
      if (!json || typeof json !== 'object') {
        throw new WhirlpoolError('unavailable', 'Whirlpool refused the request', { status: 403 });
      }
    }
    if (answer.status === 401 || answer.status === 403) {
      throw new WhirlpoolError('unauthorized', 'Whirlpool refused the session', {
        status: answer.status,
      });
    }
    if (answer.status === 400 && method === 'POST') {
      throw new WhirlpoolError('invalid_command', 'Whirlpool refused the values', { status: 400 });
    }
    if (answer.status < 200 || answer.status >= 300) {
      throw new WhirlpoolError('http', 'request failed', { status: answer.status });
    }
    return answer.body;
  }

  /**
   * An authenticated call. A refused token is renewed once (refresh token)
   * and the call retried once; refused again, or refused right after a
   * renewal, it is `session_refused`. A command (`deadline`) is never
   * retried: it may have been done.
   */
  async call(
    method,
    path,
    { allowLogin = false, timeout, deadline, device = false, ...options } = {},
  ) {
    /**
     * A refusal kept after a renewal: the session's (`session_refused`),
     * except a 403 on one appliance's path, which is that appliance's
     * (`forbidden`): a 401, or a refusal of an account path, is the session.
     */
    const refusal = (err, message) =>
      device && err.status === 403
        ? new WhirlpoolError('forbidden', 'Whirlpool refused this appliance', { status: 403 })
        : new WhirlpoolError('session_refused', message, { status: err.status });
    const fresh = await this.ensureToken({ allowLogin, timeout, deadline });
    try {
      return await this.apiSend(method, path, { ...options, timeout, deadline });
    } catch (err) {
      if (err.kind !== 'unauthorized') {
        throw err;
      }
      if (fresh || deadline !== undefined) {
        throw refusal(err, 'the session was refused');
      }
    }
    // A dead refresh token falls back to one password sign-in (a cycle only).
    await this.ensureToken({ allowLogin, timeout, force: true });
    try {
      return await this.apiSend(method, path, { ...options, timeout });
    } catch (err) {
      if (err.kind === 'unauthorized') {
        throw refusal(err, 'the session was refused right after a renewal');
      }
      throw err;
    }
  }

  async callJson(method, path, options) {
    return parseJson(await this.call(method, path, options));
  }

  /** The account id: from the token answer, otherwise getUserDetails (auth.py get_account_id). */
  async account(options = {}) {
    // The sign-in answer usually carries the account id: sign in first.
    await this.ensureToken(options);
    if (this.accountId) {
      return this.accountId;
    }
    const json = await this.callJson('GET', PATHS.userDetails, options);
    const id = text(json?.accountId, 64);
    if (!ID.test(id)) {
      throw new WhirlpoolError('bad_response', 'Whirlpool sent no account id');
    }
    this.accountId = id;
    await this.changed();
    return id;
  }

  /**
   * The appliances of the account: owned (every location, legacy and "ts"
   * lists), then shared with it. A failure of the shared list is ignored
   * (not every brand and region supports sharing, says the reference).
   */
  async appliances(options = {}) {
    const account = await this.account(options);
    const owned = await this.callJson('GET', PATHS.owned(account), {
      ...options,
      maxBytes: LIMITS.listBytes,
    });
    const locations = owned?.[account];
    if (!locations || typeof locations !== 'object') {
      throw new WhirlpoolError('bad_response', 'Whirlpool sent no appliance list');
    }
    const list = [];
    for (const location of Object.values(locations)) {
      for (const raw of [
        ...(Array.isArray(location?.legacyAppliance) ? location.legacyAppliance : []),
        ...(Array.isArray(location?.tsAppliance) ? location.tsAppliance : []),
      ]) {
        list.push(applianceOf(raw));
      }
    }
    let shared;
    try {
      shared = await this.callJson('GET', PATHS.shared, {
        ...options,
        headers: { 'WP-CLIENT-BRAND': BRAND_HEADER[this.brand] },
        maxBytes: LIMITS.listBytes,
      });
    } catch (err) {
      // Only a failure of the endpoint itself is ignored; the account's never is.
      if (isAccountError(err) || !SHARED_IGNORED.has(err.kind)) {
        throw err;
      }
      shared = undefined;
    }
    for (const group of Array.isArray(shared?.sharedAppliances) ? shared.sharedAppliances : []) {
      for (const raw of Array.isArray(group?.appliances) ? group.appliances : []) {
        list.push(applianceOf(raw, true));
      }
    }
    const seen = new Set();
    return list.filter((a) => a && !seen.has(a.said) && seen.add(a.said));
  }

  /** The attributes of one appliance: name -> string value (httpapi/appliance.py fetch_data). */
  async data(said, options = {}) {
    const json = await this.callJson('GET', PATHS.data(said), { ...options, device: true });
    const attributes = json?.attributes;
    if (!attributes || typeof attributes !== 'object' || Array.isArray(attributes)) {
      throw new WhirlpoolError('bad_response', 'Whirlpool sent no attributes');
    }
    const values = new Map();
    for (const [name, entry] of Object.entries(attributes)) {
      const value = entry?.value;
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        values.set(name, String(value));
      }
    }
    return values;
  }

  /** setAttributes on one appliance (httpapi/appliance.py send_attributes); never retried. */
  async command(said, attributes, options = {}) {
    await this.call('POST', PATHS.command, {
      ...options,
      device: true,
      payload: { body: attributes, header: { said, command: 'setAttributes' } },
    });
  }
}
