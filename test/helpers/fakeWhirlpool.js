// -----------------------------------------------------------------------------
// A fake Whirlpool cloud behind the transport the integration is given: the
// token endpoint (password and refresh grants), the account, the owned and
// shared appliance lists, the attributes of each appliance and the command
// endpoint. Answers are shaped like the ones whirlpool-sixth-sense parses.
// Records every request. No network.
// -----------------------------------------------------------------------------

import { WhirlpoolError } from '../../src/http.js';
import { ACCOUNT_ID, EMAIL, PASSWORD, allData, owned, shared } from '../fixtures/whirlpool.js';

const answer = (status, body, headers = {}) => ({
  status,
  headers,
  body: body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body),
});

export function fakeWhirlpool({ lifetime = 3600, host = 'prod-api.whrcloud.eu' } = {}) {
  const server = {
    host,
    email: EMAIL,
    password: PASSWORD,
    lifetime,
    /** Sent in the token answer (the reference reads it from there first). */
    accountInToken: true,
    owned: owned(),
    shared: shared(),
    /** SAID -> { attribute: value } */
    data: allData(),
    /** { method, host, path, query, headers, form, json } */
    requests: [],
    access: new Set(),
    refreshes: new Set(),
    sessions: 0,
    /** Every secret ever issued, to check none reaches the logs. */
    secrets: [],
    down: false,
    /** One-shot answers: { match(request), status, body, headers } */
    queue: [],
    /** Called before answering, may throw (a timeout...). */
    before: undefined,
    of(path) {
      return this.requests.filter((r) => r.path === path);
    },
    tokenCalls(grant) {
      return this.of('/oauth/token').filter((r) => !grant || r.form.grant_type === grant);
    },
    commands() {
      return this.of('/api/v1/appliance/command');
    },
    reads(said) {
      return this.requests.filter((r) => r.path === `/api/v1/appliance/${said}`);
    },
    set(said, attribute, value) {
      this.data[said][attribute] = value;
    },
    revokeAccess() {
      this.access.clear();
    },
    revokeRefresh() {
      this.refreshes.clear();
    },
    issue(prefix) {
      this.sessions += 1;
      const token = `${prefix}-${this.sessions}-${Math.random().toString(36).slice(2)}`;
      this.secrets.push(token);
      return token;
    },
    tokens() {
      const access = this.issue('access');
      const refresh = this.issue('refresh');
      this.access.add(access);
      this.refreshes.add(refresh);
      return {
        access_token: access,
        refresh_token: refresh,
        token_type: 'bearer',
        expires_in: this.lifetime,
        ...(this.accountInToken ? { accountId: Number(ACCOUNT_ID), SAID: [] } : {}),
      };
    },
  };

  server.transport = async (url, { method = 'GET', headers = {}, body } = {}) => {
    const target = new URL(url);
    const contentType = String(headers['Content-Type'] ?? '');
    const request = {
      method,
      host: target.host,
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      headers,
      form: contentType.includes('x-www-form-urlencoded')
        ? Object.fromEntries(new URLSearchParams(body))
        : undefined,
      json: contentType.includes('json') && body ? JSON.parse(body) : undefined,
    };
    server.requests.push(request);
    await server.before?.(request);
    if (server.down) {
      throw new WhirlpoolError('network', 'connection refused');
    }
    const forced = server.queue.findIndex((q) => q.match(request));
    if (forced >= 0) {
      const [{ status, body: forcedBody, headers: forcedHeaders }] = server.queue.splice(forced, 1);
      return answer(status, forcedBody, forcedHeaders);
    }
    if (target.host !== server.host) {
      return answer(404, 'not found');
    }
    if (request.path === '/oauth/token' && method === 'POST') {
      const form = request.form ?? {};
      if (!form.client_id || !form.client_secret) {
        return answer(401, { error: 'invalid_client' });
      }
      if (form.grant_type === 'password') {
        if (form.username !== server.email || form.password !== server.password) {
          return answer(400, { error: 'invalid_grant', error_description: 'Bad credentials' });
        }
        return answer(200, server.tokens());
      }
      if (form.grant_type === 'refresh_token') {
        if (!server.refreshes.has(form.refresh_token)) {
          return answer(401, { error: 'invalid_token' });
        }
        server.refreshes.delete(form.refresh_token);
        return answer(200, server.tokens());
      }
      return answer(400, { error: 'unsupported_grant_type' });
    }
    const bearer = String(headers.Authorization ?? '').replace(/^Bearer /, '');
    if (!server.access.has(bearer)) {
      return answer(401, { error: 'invalid_token' });
    }
    if (request.path === '/api/v1/getUserDetails' && method === 'GET') {
      return answer(200, { accountId: Number(ACCOUNT_ID), firstName: 'x' });
    }
    if (request.path === `/api/v3/appliance/all/account/${ACCOUNT_ID}` && method === 'GET') {
      return answer(200, { [ACCOUNT_ID]: server.owned });
    }
    if (request.path === '/api/v1/share-accounts/appliances' && method === 'GET') {
      return answer(200, server.shared);
    }
    const match = /^\/api\/v1\/appliance\/([^/]+)$/.exec(request.path);
    if (match && method === 'GET') {
      const attrs = server.data[match[1]];
      if (!attrs) {
        return answer(404, { error: 'not found' });
      }
      return answer(200, {
        applianceId: match[1],
        attributes: Object.fromEntries(
          Object.entries(attrs).map(([k, v]) => [k, { value: v, updateTime: 1 }]),
        ),
      });
    }
    if (request.path === '/api/v1/appliance/command' && method === 'POST') {
      const said = request.json?.header?.said;
      if (!server.data[said] || request.json?.header?.command !== 'setAttributes') {
        return answer(400, { error: 'bad command' });
      }
      for (const [k, v] of Object.entries(request.json.body ?? {})) {
        server.data[said][k] = v;
      }
      return answer(200, { status: 'ok' });
    }
    return answer(404, 'not found');
  };

  return server;
}

/** An in-memory store, in place of the /data file. */
export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 20) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
