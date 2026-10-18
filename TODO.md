# TODO — Whirlpool 6th Sense v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (post #262, lot 7) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-18): sign-in and token renewal by
      timer ported from whirlpool-sixth-sense 2.1.1 (EU and US, Whirlpool,
      Maytag, KitchenAid), owned and shared appliance lists, washers and
      dryers (state, cycle, phase, time remaining, door), "cycle finished"
      scene trigger, ovens read only (state, temperature, door per cavity),
      air conditioners behind an option (state, buttons, mode, setpoint,
      temperature, humidity), persisted stops and pauses, badges, docs
      en/fr, cover. Tested against made-up answers only (Node 22 and 24).
      No Docker on this PC: the image was not built here (the CI builds it).
- [ ] **Milestone 2 — real account**: run against a real account (see "To
      check on a real account"), turn the answers (anonymized) into
      fixtures, fix what differs.
- [ ] **Milestone 3 — live updates**: the STOMP websocket of the reference
      (`/api/v1/client_auth/webSocketUrl`, `CONNECT` with `wcloudtoken`,
      one `SUBSCRIBE` per SAID, the REST keep-alive every 5 minutes, the
      reconnection rules), with REST polling as a true-up, if it proves
      stable. Then the cycle end trigger would be immediate.
- [ ] **Milestone 4 — more appliances**: the AWS IoT appliances of the
      reference (Cognito identity, SigV4, MQTT over websocket; only
      microwaves there in 2.1.1), refrigerators (read only), microwaves
      (read only), the dryer and washer details (detergent level, cycle
      count, wrinkle shield, dryness).
- [ ] **Later, not in v1 — washer and dryer commands**: no remote start,
      pause or cancel in v1 (decision of the brief). If ever added: off by
      default behind an option, only when the appliance reports remote
      start enabled (`XCat_RemoteSetRemoteControlEnable`), push buttons,
      a fresh read just before acting.

## To check on a real account

- The token answer: `expires_in` (one hour assumed when absent), the
  rotation of the refresh token, `accountId` present or not (then
  `getUserDetails`), the status of a wrong password (400 and 401 read as
  refused), of a locked account (423).
- The lists: the shape of `/api/v3/appliance/all/account/<id>` (locations,
  `legacyAppliance`, `tsAppliance`), the shared list per brand and region,
  the data model keys of real washers, dryers and ovens (an oven whose
  model is not in the reference's list is not shown).
- The attributes: the machine states seen during a real cycle (does
  "complete" (10) always come before standby? if a machine goes straight
  from running to standby, the trigger is missed), the phase flags, the
  time remaining in seconds, `Cavity_CycleSetCycleName` (empty on the
  reference's washer), the oven temperatures in tenths of °C in the US too.
- The command answer of an air conditioner, the delay before a read shows
  it (the 20 s hold), the setpoint range and step the appliance accepts.
- Rate limits: none documented; the Home Assistant integration uses the
  websocket plus one REST read every 5 minutes. Watch for 429 and 403.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-whirlpool:0.1.0`);
  the first patch release gives 0.1.1. `test/manifest.test.js` checks the
  four agree.
- **HTTP API only, polling** ("lecture prudente"): the reference's websocket
  is not simple (STOMP frames, a REST keep-alive to keep events flowing,
  reconnection delays, and AWS IoT MQTT with SigV4 for the newest
  appliances). One read per appliance per interval (60 s by default, 60 to
  900), the lists every 30 minutes. AWS IoT appliances are not shown (the
  reference supports only microwaves there).
- **Washers, dryers and ovens are read only**: no start, pause, cancel,
  heating, light, lock or timer command, so no `switch`, no writable
  feature on them. Oven temperatures are `temperature-sensor/probe` (kept
  out of the room average); the oven setpoint is not shown (0 when off, it
  would mislead).
- **Air conditioners behind `enable_aircon` (off by default)**: option off,
  they are no longer read, their states no longer sent and every command is
  refused (checked when the command's turn comes and again right before it
  leaves); an air conditioner already added stays in Gladys with the
  "unreachable" badge, and a new one is not offered. On:
  on/off is a read-only `air-conditioning/binary` plus two `button/push`
  ("Turn on", "Turn off"), so an "everything off" never reaches them;
  `air-conditioning/mode` (AUTO = 6th Sense, COOLING, HEATING, FAN; DRYING
  refused) and `air-conditioning/target-temperature` (16–30 °C, the range of
  the Home Assistant integration, rounded to the declared 1 °C step). Values
  validated strictly (null, '' and booleans are not numbers). Voice
  assistants, HomeKit and the MCP cannot turn them on or off (the state is
  read only) but can change the mode, heating included, and the setpoint:
  said in the docs.
- **Machine states as `text/select`** with stable string values (standby,
  running, complete…; close codes grouped), the phase as `text/select`, the
  cycle as `text/text` (the cycle name when the appliance gives one, the
  reference's dryer cycle names, otherwise "Cycle <n>"), the time remaining
  as `duration/integer` in minutes (0 outside a cycle), the door as
  `opening-sensor/binary` (OPEN 0, CLOSE 1).
- **Cycle end trigger** (`cycle_finished`): a transition from running,
  finishing, paused or delayed to complete, seen between two reads of this
  run (never on the first read after a start: no stale event). Data:
  `appliance` (the device external id when created), `appliance_name`,
  `kind`, `kind_label`, `cycle`.
- **Sign-in**: the password grant is used at the start when no stored
  session works, after a refused refresh token (once per cycle), and on the
  button. Never from a command. A refused password (400/401/403 with a
  JSON body) and a locked account (423) are persisted stops tied to a
  short keyed fingerprint (HMAC by the random salt, 4 hex digits: only a
  change detector, it says next to nothing of the password): no retry until the credentials change or the button
  is clicked (repeated refusals could lock the account). Whirlpool sends no
  verification code: none is ever sent or asked.
- **Token renewal by timer**: 10 minutes before the end (half the lifetime
  when shorter, at least 1 minute after issue); a failed renewal is retried
  after 1, 5, then 15 minutes, a refused one leaves the next cycle to sign
  in once. The access token stays in memory; a restart renews it with the
  stored refresh token.
- **Errors**: 401, or a 403 with a JSON body, is the session (renewed once,
  then `session_refused` with retries after 1 h, 6 h, 24 h); a 403 without
  JSON (a CDN) is transient; 429 pauses every path, persisted and capped
  (1 min – 6 h); one appliance's error never stops the others, the account's
  errors stop the cycle.
- **Brands and regions**: Whirlpool and KitchenAid in both regions, Maytag
  in the United States only (no EU client in the reference: said in the
  status, nothing sent). Consul (Latin America) is not offered.
- The OAuth client ids and secrets of the apps come from the reference:
  they identify the apps, not the user; still never logged.

## Review of Milestone 1 (decisions)

- The shared list rethrows every error of the account (refused, locked,
  unexpected sign-in, no credentials, no client, session refused, expired, 429) and any error of the token endpoint; it ignores only `http`,
  `bad_response`, `size`, `unavailable` and `network`.
- An error of the token endpoint is marked `auth` and stops the cycle like
  an error of the account: never one renewal or sign-in per appliance.
- On an appliance's path (attributes, command), a 403 with a JSON body kept
  after a renewal is that appliance's error (`forbidden`): the others are
  read, the account is not stopped. A 401, or a refusal on an account path,
  is the session.
- Before a command, the appliance is read again within the 4 s budget
  (keeping 1.5 s for the command) and the command leaves only if that read
  says it is online (an unknown online state is refused). The option, the
  feature's writer and the run are checked when the command's turn comes and
  again right before the request leaves, after any renewal.
- A command answered by a 5xx other than 503 may have been done: "sent,
  without confirmation", read again 5 s later. A 503 is "not done".
- A token living less than 2 minutes keeps a quarter of its life as the
  margin (not 30 s), and its timer fires at half its life at the latest.
- A command waits for a sign-in in progress only within its budget (then
  `late`, nothing sent).
- Command errors are in the configured language (fr/en).
- Another account (e-mail, brand or region) empties the Discovery list of
  the previous one; option off, no air conditioner state is sent again.
- A SAID longer than 64 characters is dropped, never cut.

## Not verified

- Never run against the real cloud nor a real appliance.
- The Docker image was not built on this PC (no Docker): the CI builds it.
- The store validator: see the Milestone 1 commit message.
