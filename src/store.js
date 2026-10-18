// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), never the e-mail nor the password:
//   - a random salt made once (for the fingerprint below);
//   - the refresh token (not the access token) and the account id, with the
//     account they belong to (a hash of the brand, region and e-mail), so a
//     restart does not sign in again with the password; written only when
//     one of them changes;
//   - the end of a 429 pause (kept across restarts and account changes);
//   - a stop (refused credentials, locked account, unexpected sign-in
//     answer, refused session and its spaced retries), tied to a salted
//     fingerprint of the account and password, so a restart does not retry
//     what Whirlpool refused, and a new password does.
// The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { createHash, randomBytes } from 'node:crypto';
import { open, readFile, rename } from 'node:fs/promises';
import { TIMINGS } from './constants.js';

export const STATE_FILE = '/data/whirlpool-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(text);
          // On disk before it replaces the previous state (a power cut keeps one of the two).
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

export const newSalt = () => randomBytes(16).toString('hex');

/** The salted fingerprint of the credentials a stop belongs to (16 hex digits). */
export const fingerprint = (salt, account, password) =>
  createHash('sha256').update(`${salt}\n${account}\n${password}`).digest('hex').slice(0, 16);

const time = (value) => (Number.isFinite(value) ? value : undefined);
const str = (value, max = 8192) =>
  typeof value === 'string' && value !== '' && value.length <= max ? value : undefined;

export const BLOCKS = new Set(['refused', 'locked', 'login_rejected', 'session_refused']);

/** The persisted state, repaired; the pause and retry ends are capped from `now`. */
export function normalizeMemory(raw, now = Date.now()) {
  const session = raw?.session;
  const refresh = str(session?.refresh);
  const block = raw?.block;
  const capped = (value, max) =>
    time(value) === undefined ? undefined : Math.min(value, now + max);
  const accountId = str(session?.accountId, 64);
  return {
    salt: typeof raw?.salt === 'string' && /^[0-9a-f]{32}$/.test(raw.salt) ? raw.salt : null,
    session:
      refresh && /^[0-9a-f]{16}$/.test(session?.account ?? '')
        ? {
            account: session.account,
            refresh,
            accountId: accountId && /^[A-Za-z0-9_.-]+$/.test(accountId) ? accountId : undefined,
          }
        : null,
    rateLimitedUntil: capped(raw?.rateLimitedUntil, TIMINGS.rateLimitMax),
    block:
      BLOCKS.has(block?.kind) && /^[0-9a-f]{16}$/.test(block?.fingerprint ?? '')
        ? {
            kind: block.kind,
            fingerprint: block.fingerprint,
            retryAt: capped(block.retryAt, TIMINGS.sessionRetry[TIMINGS.sessionRetry.length - 1]),
            retries:
              Number.isInteger(block.retries) && block.retries >= 0
                ? Math.min(block.retries, 10)
                : 0,
          }
        : null,
  };
}
