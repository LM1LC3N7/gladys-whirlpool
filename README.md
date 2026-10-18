# gladys-whirlpool

[Gladys Assistant](https://gladysassistant.com) external integration for the
**Whirlpool, Maytag and KitchenAid** appliances of the "6th Sense Live" apps
(Whirlpool cloud, Europe and United States): washers and dryers (state,
cycle, phase, time remaining, door, and a "Cycle finished" scene trigger),
ovens (state, temperature and door, read only: never heated from Gladys),
and air conditioners (state, temperature, setpoint and mode) behind an
option off by default. **Unofficial API, never tested with a real appliance
or account. Not affiliated with Whirlpool, Maytag or KitchenAid.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (WhirlpoolApp)
                                  ├─ src/client.js     sign-in, token renewal, 5 cloud calls
                                  ├─ src/http.js       the only HTTPS access, errors, bounds
                                  ├─ src/model.js      kinds and attribute readings (pure)
                                  ├─ src/devices.js    appliance -> Gladys features, AC commands (pure)
                                  ├─ src/publisher.js  states within 300/min
                                  └─ src/store.js      /data/whirlpool-state.json
```

- **Sign-in** (as whirlpool-sixth-sense): `POST /oauth/token` on
  `prod-api.whrcloud.eu` (EU) or `api.whrcloud.com` (US), password grant
  with the OAuth client of the brand's app; the refresh token renews it.
  The renewal runs on a **timer**, 10 minutes before the token ends (half
  its lifetime when shorter), so neither a read nor a command waits for it.
  Only the refresh token and the account id are kept in `/data`. A refused
  refresh token falls back to **one** password sign-in per cycle, never
  from a command; a refused password (400/401) or a locked account (423) is
  a persisted stop, retried only by the user (new credentials, _Test the
  connection_). No verification code exists for these accounts: none is
  ever asked.
- **Reads**: the appliance lists (`/api/v3/appliance/all/account/<id>`, all
  locations, legacy and "ts" lists, then the shared ones with
  `WP-CLIENT-BRAND`) every 30 minutes; the attributes of each supported
  appliance (`/api/v1/appliance/<SAID>`) every 60 s (60–900). Answers read
  up to 1 MiB (2 MiB for a list). One appliance failing never hides the
  others.
- **No live updates**: the reference's STOMP websocket also needs a REST
  keep-alive every 5 minutes, reconnection rules and, for the newest
  appliances, AWS IoT over SigV4 MQTT. v1 reads politely instead (see
  TODO.md).
- **Commands**: air conditioners only, behind `enable_aircon`:
  `POST /api/v1/appliance/command` (`setAttributes`), one at a time per
  appliance, refused before they are sent when less than 1.5 s is left of a
  4 s budget (Gladys acks in 5 s); never retried (it may have been done); a
  command without an answer is reported sent without confirmation and read
  again 5 s later. Setpoint 16–30 °C, modes 6th Sense/cool/heat/fan,
  on/off as two push buttons. Nothing is ever sent to a washer, dryer or
  oven.
- **Errors**: a refused token is renewed once and the call retried once;
  refused again, a pause and one new try after 1 h, 6 h, then every 24 h.
  429 pauses every path (`Retry-After` bounded to 1 min – 6 h, 10 min
  without it); 5xx/network: 1, 2, 5, 10, then 15 minutes, never under the
  interval. Stops and pauses are kept in `/data` and capped when read back;
  a reconnection to Gladys keeps them.
- **Gladys side**: one device per appliance (`appliance:<SAID>`);
  categories `text` (select and text states), `duration` (minutes),
  `opening-sensor`, `temperature-sensor` (`probe` for ovens),
  `air-conditioning`, `button`, `humidity-sensor`. Never a `switch`. The
  Discovery list never shrinks; status and Discovery are sent again at
  every reconnection.
- **Scene trigger** `cycle_finished`: a washer or dryer going from a cycle
  to "complete", once per cycle.

## Credits

The sign-in, the cloud calls and the attribute readings are ported from
[whirlpool-sixth-sense](https://github.com/abmantis/whirlpool-sixth-sense)
(Abílio Costa, MIT, tag 2.1.1), the library of the Home Assistant Whirlpool
integration; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Modelled
on the sibling integration
[gladys-hubspace](https://github.com/LM1LC3N7/gladys-hubspace) (cloud
account, several device types).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
node .github/scripts/make-cover.mjs cover.png   # the 800x534 store cover, plain Node
```

Tests never touch the network: the Whirlpool cloud is a fake behind the
injected transport (answers shaped like the reference's `tests/data`),
Gladys is the SDK's fake; `test/http.test.js` runs the real transport
against a loopback server.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from an MIT project, credited
with its notice in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also
shipped in the Docker image).
