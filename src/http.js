// -----------------------------------------------------------------------------
// The only network access: HTTPS requests to the Whirlpool cloud, and the
// errors they end with. The body read is bounded, the promise settles once,
// nothing secret (password, token, client secret) ever goes into an error
// message: only a kind, a short reason and a status.
// -----------------------------------------------------------------------------

import https from 'node:https';
import http from 'node:http';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed Whirlpool call. `kind`:
 * - `no_credentials`: no e-mail or password (never sent);
 * - `no_client`: this brand has no app in this region (Maytag in Europe);
 * - `refused`: the sign-in refused the e-mail or the password;
 * - `locked`: the account is locked (HTTP 423, too many attempts);
 * - `login_rejected`: the sign-in answered something unexpected;
 * - `token_refused`: the refresh token was refused;
 * - `unauthorized`: the API refused the token (401, or a 403 of the API);
 * - `session_refused`: refused again right after a renewal;
 * - `rate_limited`: 429, `retryAfter` in ms when given;
 * - `unavailable`: 5xx, or a 403 that is not an answer of the API (a CDN);
 * - `network`, `timeout`: no answer; `late`: not enough time left (a command);
 * - `bad_response`, `size`: not the expected answer; `http`: any other status;
 * - `invalid_command`: the API refused the values of a command (400);
 * - `forbidden`: a 403 of one appliance's path, kept after a renewal: an
 *   error of that appliance, not of the account;
 * - `cancelled`: a command whose conditions changed before it left (never sent).
 * `sent`: a command that may have reached the appliance (no answer).
 */
export class WhirlpoolError extends Error {
  constructor(kind, message, { status, retryAfter } = {}) {
    super(message);
    this.name = 'WhirlpoolError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.sent = false;
    /** An error of the token endpoint (sign-in or renewal): the account's. */
    this.auth = false;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
};

/** A socket error -> WhirlpoolError (never the request: the sign-in carries the password). */
export function networkError(err) {
  if (err instanceof WhirlpoolError) {
    return err;
  }
  return new WhirlpoolError('network', NETWORK_REASONS[err?.code] ?? 'network error');
}

/** A short, secret-free reason for a log or a status message. */
export function errorReason(err) {
  if (err instanceof WhirlpoolError) {
    return err.status ? `${err.message} (HTTP ${err.status})` : err.message;
  }
  return 'unexpected error';
}

/** One request; resolves `{ status, headers, body }` whatever the status. */
export function httpRequest(
  url,
  {
    method = 'GET',
    headers = {},
    body,
    timeout = TIMINGS.requestTimeout,
    maxBytes = LIMITS.dataBytes,
  } = {},
) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const lib = target.protocol === 'https:' ? https : http;
    let timer;
    let settled = false;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    const req = lib.request(target, { method, headers }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          settle(reject, new WhirlpoolError('size', 'answer too large'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () =>
        settle(resolve, {
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
      res.on('error', (err) => settle(reject, networkError(err)));
    });
    timer = setTimeout(
      () => {
        settle(
          reject,
          new WhirlpoolError('timeout', `no answer within ${Math.round(timeout / 1000)} s`),
        );
        req.destroy();
      },
      Math.max(1, timeout),
    );
    req.on('error', (err) => settle(reject, networkError(err)));
    req.end(body);
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

/** The JSON of a body, `undefined` when empty or not JSON. */
export function tryJson(body) {
  if (body === undefined || body === null || String(body).trim() === '') {
    return undefined;
  }
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

/** The JSON of a body; `bad_response` when it is not JSON. */
export function parseJson(body) {
  const json = tryJson(body);
  if (json === undefined) {
    throw new WhirlpoolError('bad_response', 'Whirlpool sent an answer that is not JSON');
  }
  return json;
}

/**
 * Errors of the account, not of one appliance or one endpoint: they stop the
 * cycle, and are never swallowed (an error of the token endpoint, `auth`,
 * counts as one too: see isAccountError).
 */
export const ACCOUNT_ERRORS = new Set([
  'refused',
  'no_credentials',
  'no_client',
  'locked',
  'login_rejected',
  'session_refused',
  'expired',
  'rate_limited',
]);

export const isAccountError = (err) =>
  !(err instanceof WhirlpoolError) || err.auth === true || ACCOUNT_ERRORS.has(err.kind);

/** The transient errors of every call: 429, 5xx. Undefined otherwise. */
export function transientError({ status, headers = {} }, now) {
  if (status === 429) {
    return new WhirlpoolError('rate_limited', 'too many requests', {
      status,
      retryAfter: parseRetryAfter(headers['retry-after'], now),
    });
  }
  if (status >= 500) {
    return new WhirlpoolError('unavailable', 'Whirlpool is unavailable', { status });
  }
  return undefined;
}
