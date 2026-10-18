// -----------------------------------------------------------------------------
// Manifest keys, Whirlpool cloud constants, limits and timings.
//
// The API is the one of the 6th Sense Live apps (Whirlpool, Maytag,
// KitchenAid), undocumented. Hosts, paths, the OAuth clients of each brand
// and region, and the attribute names are those of whirlpool-sixth-sense
// (MIT, abmantis/whirlpool-sixth-sense 2.1.1), the library of the Whirlpool
// integration of Home Assistant.
// -----------------------------------------------------------------------------

/** `URLS` of whirlpool-sixth-sense (backendselector.py). */
export const HOSTS = {
  eu: 'prod-api.whrcloud.eu',
  us: 'api.whrcloud.com',
};

/**
 * `CREDENTIALS` of whirlpool-sixth-sense (backendselector.py): the OAuth
 * client of each app. They are the public identifiers of the Android apps,
 * not user secrets; still never logged. Maytag has no EU client.
 */
export const CLIENTS = {
  eu: {
    whirlpool: {
      id: 'whirlpool_emea_android_v2',
      secret: '90_3TBRfXfcdCYJj6L5BThEqOBZNkEchrTPT7loqm0gBS_tyeFIIEv47mmYTZkb6',
    },
    kitchenaid: {
      id: 'kitchenaid_android_stg',
      secret:
        'Dn-ukFAFoSWOnB9nVm7Y2DDj4Gs9Bocm6aOkhy0mdNGBj5RcoLkRfCXujuxpKrqF2w15sl1tI45JXwK5Zi4saw',
    },
  },
  us: {
    whirlpool: {
      id: 'whirlpool_android_v2',
      secret: 'rMVCgnKKhIjoorcRa7cpckh5irsomybd4tM9Ir3QxJxQZlzgWSeWpkkxmsRg1PL-',
    },
    maytag: {
      id: 'maytag_android_v2',
      secret: 'ULTqdvvqK0O9XcSLO3nA2tJDTLFKxdaaeKrimPYdXvnLX_yUtPhxovESldBId0Tf',
    },
    kitchenaid: {
      id: 'kitchenaid_android_v2',
      secret: 'jd15ExiJdEt8UgLWBslwkzkQkmRGCR9lVSgeaqcPmFZQc9pgxtpjmaPSw3g-aRXG',
    },
  },
};

/** The `WP-CLIENT-BRAND` header of the shared appliances call (the `Brand` enum names). */
export const BRAND_HEADER = { whirlpool: 'Whirlpool', maytag: 'Maytag', kitchenaid: 'KitchenAid' };

export const BRANDS = ['whirlpool', 'maytag', 'kitchenaid'];
export const REGIONS = ['eu', 'us'];

/** The User-Agent of whirlpool-sixth-sense (the Android app's HTTP client). */
export const USER_AGENT = 'okhttp/3.12.0';

export const PATHS = {
  token: '/oauth/token',
  userDetails: '/api/v1/getUserDetails',
  owned: (accountId) => `/api/v3/appliance/all/account/${encodeURIComponent(accountId)}`,
  shared: '/api/v1/share-accounts/appliances',
  data: (said) => `/api/v1/appliance/${encodeURIComponent(said)}`,
  command: '/api/v1/appliance/command',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

export const SCENE_TRIGGERS = {
  CYCLE_FINISHED: 'cycle_finished',
};

/** Refresh interval, in seconds: one request per appliance at each cycle. */
export const POLL_INTERVAL = { min: 60, max: 900, default: 60 };

/** Air conditioner setpoint accepted from Gladys, in °C (the range of the Home Assistant integration). */
export const AC_SETPOINT = { min: 16, max: 30, step: 1 };

export const LIMITS = {
  /** Gladys: 300 states per minute; a margin is kept for the commands. */
  statesPerMinute: 250,
  statesPerRequest: 100,
  /** One appliance's attributes: about 120 KB in the reference's fixtures. */
  dataBytes: 1024 * 1024,
  /** The appliance lists of a large account. */
  listBytes: 2 * 1024 * 1024,
  /** A token answer. */
  authBytes: 64 * 1024,
  /** Appliances read (and published) at most. */
  appliances: 50,
  /** A text state (a cycle name) is cut to this length. */
  text: 100,
};

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  requestTimeout: 20 * SECOND,
  /** The button (60 s for Gladys): shorter requests. */
  quickTimeout: 8 * SECOND,
  /** Gladys waits 5 s for a command: past this, a command is refused before it is sent. */
  commandBudget: 4 * SECOND,
  /** Not even started with less than this left: the answer would come after Gladys gave up. */
  commandMinimum: 1500,
  /** A commanded value wins over the polled one this long, unless the poll confirms it. */
  commandHold: 20 * SECOND,
  /** After a command: read again this soon. */
  confirmRead: 5 * SECOND,
  /** The token is renewed by a timer this long before it expires... */
  refreshAhead: 10 * MINUTE,
  /** ...but never sooner than this after it was issued (a very short lifetime). */
  refreshMinimum: MINUTE,
  /** When the token answer has no usable expires_in, or one under tokenMinimumLifetime. */
  tokenDefault: HOUR,
  tokenMinimumLifetime: 2 * MINUTE,
  /** A request is never sent with a token that ends within this margin. */
  tokenMargin: 30 * SECOND,
  /** The appliance lists are read again this often (the states at every cycle). */
  listInterval: 30 * MINUTE,
  /** After a session refused twice: one new try after 1 h, 6 h, then every 24 h. */
  sessionRetry: [HOUR, 6 * HOUR, 24 * HOUR],
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
  /** Pauses after a failed read, never shorter than the interval: 1, 2, 5, 10, then 15 min. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE],
  /** A failed renewal by the timer is tried again after this (the polling goes on meanwhile). */
  refreshRetry: [MINUTE, 5 * MINUTE, 15 * MINUTE],
  /** 429: Retry-After bounded to 1 minute .. 6 hours, 10 minutes without it. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 10 * MINUTE,
  testCooldown: 30 * SECOND,
};
