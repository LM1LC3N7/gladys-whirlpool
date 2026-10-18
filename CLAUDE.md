# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It signs in to the
Whirlpool cloud (EU or US; Whirlpool, Maytag or KitchenAid app) with the
e-mail and password of the app, renews the token by a timer, reads every
supported appliance once per cycle and shows washers, dryers and ovens read
only (plus a "cycle finished" scene trigger), and air conditioners behind an
option. Ported from whirlpool-sixth-sense (MIT). Unofficial API, never tested
with a real appliance or account, not affiliated with Whirlpool, Maytag or
KitchenAid.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          WhirlpoolApp: cycle and its timer, token renewal timer, failures,
                    stops and pauses, devices, states, scene trigger, AC commands, badges
src/client.js       the account: sign-in, tokens, the 5 cloud calls
src/http.js         the only network access (node:https, bounded), errors
src/model.js        data model -> kind, attributes -> readings (pure)
src/devices.js      appliance -> Gladys features, states, AC commands (pure)
src/publisher.js    states within 300/min
src/store.js        /data/whirlpool-state.json: refresh token, pause, stops
src/config.js       config_schema normalized, account key (hash)
src/constants.js    hosts, OAuth clients, paths, manifest keys, limits, timings
src/i18n.js         runtime texts and feature names (en/fr), command errors
test/fixtures/      answers shaped like the reference's tests/data; core units
test/helpers/       a fake Whirlpool cloud behind the transport; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: device `appliance:<SAID>`, features by key
  (see the header of `src/devices.js`). Never change how they are built.
- Manifest keys (`brand`, `region`, `email`, `password`, `poll_interval`,
  `enable_aircon`, `language`, the action `test_connection`, the scene
  trigger `cycle_finished` and its fields and variables) are frozen.
- **Washers, dryers, ovens are read only**: no start command (TODO), no
  oven heating, ever. **Never** a `switch/binary` for a command: a
  read-only state and `button/push`.
- **Air conditioners**: off by default (`enable_aircon`); setpoint bounded
  16–30 °C; values validated strictly; one command at a time per appliance,
  refused before it is sent when it cannot finish within Gladys' 5 s; never
  a password sign-in nor a retry from a command.
- **Sign-in**: refused credentials and a locked account are persisted stops,
  retried only by the user. Never log or put in a message the password, a
  token, a client secret, the e-mail or the account id.
- Polling politely: one request per appliance per cycle (60 to 900 s), the
  lists every 30 minutes, never sooner than the interval after an error;
  429 pauses every path. Never add a call outside `WhirlpoolClient`.
- The Discovery list never shrinks; status and Discovery are sent again at
  every `connected`; a reconnection keeps tokens, stops and pauses.
- Units and categories only from the core's constants
  (`test/fixtures/core-units.json`); a `secret` field is kept by Gladys in
  its database, never write that it is encrypted.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network nor the system temp directory.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow (0.1.0 was set by
  hand once, see TODO.md).
