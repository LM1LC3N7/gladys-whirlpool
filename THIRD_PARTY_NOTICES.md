# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the project below, distributed under
the MIT License, whose notice is reproduced in full as that license asks.

## whirlpool-sixth-sense

<https://github.com/abmantis/whirlpool-sixth-sense>, by Abílio Costa
(abmantis), the library of the Whirlpool integration of Home Assistant.
MIT License (`LICENSE` of the repository, tag `2.1.1`, commit
`d3798ad7fc1500b7bae1a56ac72d234d6754a3d1`, read on 2026-10-18).

Ported in `src/constants.js` and `src/client.js` (from `backendselector.py`,
`auth.py`, `httpapi/appliancesmanager.py` and `httpapi/appliance.py`): the
EU and US hosts, the OAuth client of each brand's app in each region, the
`/oauth/token` password and refresh-token grants with their `User-Agent`,
the account lock (HTTP 423), the account id of the token answer or of
`getUserDetails`, the owned appliances of every location (`legacyAppliance`
and `tsAppliance`), the shared appliances and their `WP-CLIENT-BRAND`
header, the attributes of `/api/v1/appliance/<SAID>` and the
`setAttributes` command. Ported in `src/model.js` and `src/devices.js`
(from `httpapi/appliancesmanager.py`, `washer.py`, `dryer.py`,
`httpapi/washer.py`, `httpapi/dryer.py`, `httpapi/oven.py`,
`httpapi/aircon.py`): the appliance kinds by data model (the list of oven
models), the attribute names, the machine states, the cycle status flags,
the dryer cycles, the oven cavities (upper, lower, "not present") and their
temperatures in tenths of a degree, the air conditioner modes (6th Sense
included), setpoint, power, temperature and humidity. The test fixtures are
trimmed from the library's `tests/data`. Changed: REST reads only (no
STOMP websocket nor AWS IoT MQTT), one password sign-in per cycle at most
and never from a command, the token renewed by a timer, stops and pauses
kept in `/data`, no oven command (no heating from Gladys), no washer or
dryer command, the air conditioners behind an option.

```
MIT License

Copyright (c) 2020 Abílio Costa

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Read, no code taken

- [LM1LC3N7/gladys-hubspace](https://github.com/LM1LC3N7/gladys-hubspace)
  (Apache-2.0), a sibling integration: the structure of the app, the
  publisher, the store and the tests.
