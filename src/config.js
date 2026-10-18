// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { BRANDS, CLIENTS, POLL_INTERVAL, REGIONS } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  brand: 'whirlpool',
  region: 'eu',
  poll_interval: POLL_INTERVAL.default,
  enable_aircon: false,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];

/** A short hash of the account (brand, region, e-mail): what tokens belong to, without the e-mail. */
export const accountKey = (brand, region, email) =>
  createHash('sha256')
    .update(`${brand}\n${region}\n${email.trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);

const bounded = (raw, { min, max, default: fallback }) => {
  if (raw === undefined || raw === null || raw === '') {
    return fallback;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;
};

/** Only a real `true` (or "true") turns an option on. */
const flag = (raw, fallback) =>
  raw === undefined || raw === null ? fallback : raw === true || raw === 'true';

const choice = (raw, allowed, fallback) => {
  const value = String(raw ?? fallback)
    .trim()
    .toLowerCase();
  return allowed.includes(value) ? value : fallback;
};

export function normalizeConfig(raw = {}) {
  const email = String(raw?.email ?? '').trim();
  const password = String(raw?.password ?? '');
  const brand = choice(raw?.brand, BRANDS, DEFAULTS.brand);
  const region = choice(raw?.region, REGIONS, DEFAULTS.region);
  return {
    email,
    password,
    brand,
    region,
    /** The OAuth client of this brand in this region; undefined for Maytag in Europe. */
    client: CLIENTS[region][brand],
    account: email === '' ? '' : accountKey(brand, region, email),
    pollInterval: bounded(raw?.poll_interval, POLL_INTERVAL),
    enableAircon: flag(raw?.enable_aircon, DEFAULTS.enable_aircon),
    language: choice(raw?.language, LANGUAGES, DEFAULTS.language),
  };
}
