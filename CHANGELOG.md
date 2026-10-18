# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Sign-in to the Whirlpool cloud (Europe or United States) with the e-mail
  and password of the Whirlpool, Maytag (United States) or KitchenAid app,
  as whirlpool-sixth-sense does it; the token renewed by a timer before it
  ends, the refresh token and the account id kept in `/data`. A refused
  refresh token falls back to one password sign-in, never from a command.
- Washers and dryers, read only: state, cycle, phase, time remaining
  (minutes), door. No start command.
- "Washer or dryer cycle finished" scene trigger, once per cycle, with the
  appliance, its type and the cycle.
- Ovens, read only: state, temperature (a probe, out of the room average)
  and door of each cavity. Never heated from Gladys.
- Air conditioners behind "Show the air conditioners" (off by default):
  on/off state, Turn on and Turn off push buttons, mode, setpoint
  (16–30 °C), temperature, humidity. Never a `switch/binary`.
- Owned and shared appliances; the lists read every 30 minutes, each
  appliance every 60 s (60 to 900). One appliance failing never hides the
  others; an offline appliance is shown unreachable.
- Commands one at a time per appliance, refused before they are sent when
  they cannot finish within Gladys' 5 s; a command without an answer
  reported as sent without confirmation and read again within seconds.
- Resilience: refused credentials and a locked account (423) stop until the
  configuration changes or the button is clicked; a session refused again
  after a renewal pauses 1 h, 6 h, then 24 h; 429 pauses every path (1 minute
  to 6 hours); these stops and pauses kept in `/data`; 5xx and network
  errors retried after 1 to 15 minutes.
- Status and Discovery sent again at every reconnection to Gladys; the
  Discovery list never shrinks. Transport badge per appliance.
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.

### Fixed

- The shared appliance list no longer hides a refused password or a locked
  account: the integration stops instead of trying again.
- An error of the token endpoint stops the cycle: no renewal per appliance.
- One appliance refused (HTTP 403) no longer stops the whole account.
- Air conditioner commands: the appliance is read again just before, and
  nothing is sent when it is offline; turning the option off cancels a
  queued command; a command answered by a gateway error (502, 504) is
  reported "sent, without confirmation"; the setpoint is rounded to 1 °C;
  the errors follow the configured language.
- A very short-lived token is renewed in time; a command never waits for a
  sign-in past its budget.
- Another account no longer offers the devices of the previous one; the
  air conditioner states are not sent while the option is off.
- The stops in `/data` are tied to a 4-digit keyed fingerprint (HMAC) of
  the credentials. Docs: the limits of the "Cycle finished" trigger and of
  the air conditioner commands (voice assistants, HomeKit, MCP, scenes).
- A token whose lifetime is under 2 minutes is treated as abnormal (1 hour
  assumed): at most one renewal per minute.
- A locked account or refused credentials met by a command stop the
  integration like a read does; a 429 pauses it.
- A shared list that times out no longer hides the owned appliances.
- An appliance refused with HTTP 403 no longer forces a renewal at every
  read.
- A failed read just before a command says that nothing was sent.

[Unreleased]: https://github.com/LM1LC3N7/gladys-whirlpool/commits/main
