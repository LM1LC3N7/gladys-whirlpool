// -----------------------------------------------------------------------------
// Appliance -> Gladys device (pure): its features, their states from a
// reading (src/model.js), and the commands of the air conditioners.
//
// External ids are forever: the device is `appliance:<SAID>` (through
// gladys.externalIds), each feature `<device>:<key>` with the keys below.
//   washer, dryer: state, cycle, phase, remaining, door
//   oven:          upper-state, upper-temperature, upper-door
//                  (+ lower-* when the oven has a lower cavity)
//   aircon:        power, power-on, power-off, mode, target, temperature
//                  (+ humidity when the appliance reports it)
//
// Never a switch/binary: washers, dryers and ovens are read only (no start,
// no heating from Gladys); the air conditioner's on/off is a read-only state
// and two push buttons, so an "everything off" never reaches it.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TY,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { AC_SETPOINT, LIMITS } from './constants.js';
import { CYCLE_LABELS, FEATURE_NAMES, PHASE_LABELS, STATE_LABELS, word } from './i18n.js';
import {
  AC_ATTRS,
  AC_MODE,
  AC_SET_MODE,
  LAUNDRY_STATE_VALUES,
  OVEN_STATE_VALUES,
  PHASES,
  hasCavity,
} from './model.js';

/** Gladys OPENING_SENSOR_STATE: OPEN 0, CLOSE 1. */
const OPEN = 0;
const CLOSED = 1;

export const DEVICE_TYPE = 'appliance';
export const deviceIds = (gladys, said) => gladys.externalIds(DEVICE_TYPE, said);

const door = (open) =>
  open === true ? { state: OPEN } : open === false ? { state: CLOSED } : undefined;
const num = (value) =>
  typeof value === 'number' && Number.isFinite(value) ? { state: value } : undefined;
const choice = (value) => (typeof value === 'string' ? { text: value } : undefined);

const options = (values, labels, language) =>
  values.map((value, i) => ({ value, label: word(labels[value], language), sort_order: i }));

function laundrySpecs(kind) {
  const phases = ['none', ...PHASES[kind].map(([name]) => name)];
  return [
    {
      key: 'state',
      name: 'state',
      category: C.TEXT,
      type: TY.TEXT.SELECT,
      options: (language) => options(LAUNDRY_STATE_VALUES, STATE_LABELS, language),
      read: (r) => choice(r.state),
    },
    {
      key: 'cycle',
      name: 'cycle',
      category: C.TEXT,
      type: TY.TEXT.TEXT,
      read: (r, language) => {
        if (!r.cycle) {
          return undefined;
        }
        const label = r.cycle.name
          ? r.cycle.name
          : r.cycle.key
            ? word(CYCLE_LABELS[r.cycle.key], language)
            : word(CYCLE_LABELS.number(r.cycle.number), language);
        return { text: label.slice(0, LIMITS.text) };
      },
    },
    {
      key: 'phase',
      name: 'phase',
      category: C.TEXT,
      type: TY.TEXT.SELECT,
      options: (language) => options(phases, PHASE_LABELS, language),
      read: (r) => choice(r.phase),
    },
    {
      key: 'remaining',
      name: 'remaining',
      category: C.DURATION,
      type: TY.DURATION.INTEGER,
      unit: U.MINUTES,
      min: 0,
      max: 1440,
      read: (r) => num(r.remainingMinutes),
    },
    {
      key: 'door',
      name: 'door',
      category: C.OPENING_SENSOR,
      type: TY.SENSOR.BINARY,
      read: (r) => door(r.doorOpen),
    },
  ];
}

function cavitySpecs(cavity) {
  return [
    {
      key: `${cavity}-state`,
      name: `${cavity}State`,
      category: C.TEXT,
      type: TY.TEXT.SELECT,
      options: (language) => options(OVEN_STATE_VALUES, STATE_LABELS, language),
      read: (r) => choice(r[cavity].state),
    },
    {
      // A probe: an oven is not the temperature of the room (kept out of its average).
      key: `${cavity}-temperature`,
      name: `${cavity}Temperature`,
      category: C.TEMPERATURE_SENSOR,
      type: TY.TEMPERATURE_SENSOR.PROBE,
      unit: U.CELSIUS,
      min: 0,
      max: 600,
      read: (r) => num(r[cavity].temperature),
    },
    {
      key: `${cavity}-door`,
      name: `${cavity}Door`,
      category: C.OPENING_SENSOR,
      type: TY.SENSOR.BINARY,
      read: (r) => door(r[cavity].doorOpen),
    },
  ];
}

const MODES = [AC_MODE.AUTO, AC_MODE.COOLING, AC_MODE.HEATING, AC_MODE.FAN];
const MODE_LABELS = {
  [AC_MODE.AUTO]: { en: '6th Sense (auto)', fr: '6e Sens (auto)' },
  [AC_MODE.COOLING]: { en: 'Cooling', fr: 'Froid' },
  [AC_MODE.HEATING]: { en: 'Heating', fr: 'Chaud' },
  [AC_MODE.FAN]: { en: 'Fan', fr: 'Ventilation' },
};

/** A strict number: null, '' and booleans are not 0. */
const strictNumber = (value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())
      ? Number(value.trim())
      : undefined;

function airconSpecs(humidity) {
  const press = (on) => (value) =>
    strictNumber(value) === 1
      ? { attributes: { [AC_ATTRS.power]: on ? '1' : '0' }, expect: { power: on ? 1 : 0 } }
      : { refuse: 'pressOnly' };
  return [
    {
      key: 'power',
      name: 'power',
      category: C.AIR_CONDITIONING,
      type: TY.AIR_CONDITIONING.BINARY,
      read: (r) => (r.power === null ? undefined : { state: r.power ? 1 : 0 }),
    },
    {
      key: 'power-on',
      name: 'powerOn',
      category: C.BUTTON,
      type: TY.BUTTON.PUSH,
      feedback: false,
      keepHistory: false,
      write: press(true),
    },
    {
      key: 'power-off',
      name: 'powerOff',
      category: C.BUTTON,
      type: TY.BUTTON.PUSH,
      feedback: false,
      keepHistory: false,
      write: press(false),
    },
    {
      key: 'mode',
      name: 'mode',
      category: C.AIR_CONDITIONING,
      type: TY.AIR_CONDITIONING.MODE,
      min: 0,
      max: 4,
      options: (language) =>
        MODES.map((value, i) => ({
          value,
          label: word(MODE_LABELS[value], language),
          sort_order: i,
        })),
      read: (r) => num(r.mode),
      write: (value) => {
        const mode = strictNumber(value);
        return Number.isInteger(mode) && AC_SET_MODE[mode]
          ? { attributes: { [AC_ATTRS.setMode]: AC_SET_MODE[mode] }, expect: { mode } }
          : { refuse: 'refused' };
      },
    },
    {
      key: 'target',
      name: 'target',
      category: C.AIR_CONDITIONING,
      type: TY.AIR_CONDITIONING.TARGET_TEMPERATURE,
      unit: U.CELSIUS,
      min: AC_SETPOINT.min,
      max: AC_SETPOINT.max,
      step: AC_SETPOINT.step,
      read: (r) => num(r.target),
      write: (value) => {
        const target = strictNumber(value);
        if (target === undefined || target < AC_SETPOINT.min || target > AC_SETPOINT.max) {
          return { refuse: 'refused' };
        }
        const tenths = Math.round(target * 10);
        return {
          attributes: { [AC_ATTRS.targetTemp]: String(tenths) },
          expect: { target: tenths / 10 },
        };
      },
    },
    {
      key: 'temperature',
      name: 'temperature',
      category: C.TEMPERATURE_SENSOR,
      type: TY.SENSOR.DECIMAL,
      unit: U.CELSIUS,
      min: -20,
      max: 60,
      read: (r) => num(r.temperature),
    },
    ...(humidity
      ? [
          {
            key: 'humidity',
            name: 'humidity',
            category: C.HUMIDITY_SENSOR,
            type: TY.SENSOR.DECIMAL,
            unit: U.PERCENT,
            min: 0,
            max: 100,
            read: (r) => num(r.humidity),
          },
        ]
      : []),
  ];
}

/** The feature keys of a device created in Gladys. */
const createdKeys = (created) =>
  new Set((created?.features ?? []).map((f) => String(f.external_id).split(':').pop()));

/**
 * The plan of an appliance: its kind and feature specs. A created device
 * keeps the features it was created with (a lower cavity, a humidity) even
 * when a read does not show them.
 */
export function planOf(appliance, attrs, created) {
  const keys = createdKeys(created);
  switch (appliance.kind) {
    case 'washer':
    case 'dryer':
      return { kind: appliance.kind, specs: laundrySpecs(appliance.kind) };
    case 'oven': {
      const lower = keys.has('lower-state') || hasCavity(attrs, 'lower');
      return {
        kind: 'oven',
        specs: [...cavitySpecs('upper'), ...(lower ? cavitySpecs('lower') : [])],
      };
    }
    case 'aircon':
      return {
        kind: 'aircon',
        specs: airconSpecs(keys.has('humidity') || attrs.has(AC_ATTRS.displayHumidity)),
      };
    default:
      return undefined;
  }
}

/** The Gladys device of an appliance (the Discovery list). */
export function buildDevice(gladys, appliance, plan, language) {
  const ids = deviceIds(gladys, appliance.said);
  const params = [
    ['model', appliance.model],
    ['category', appliance.category],
    ['data_model', appliance.dataModel],
  ]
    .filter(([, v]) => typeof v === 'string' && v !== '')
    .map(([name, v]) => ({ name, value: v.slice(0, 100) }));
  return {
    name: appliance.name.slice(0, 100),
    external_id: ids.device,
    should_poll: false,
    params,
    features: plan.specs.map((spec) => ({
      name: word(FEATURE_NAMES[spec.name], language).slice(0, 100),
      external_id: ids.feature(spec.key),
      category: spec.category,
      type: spec.type,
      ...(spec.unit ? { unit: spec.unit } : {}),
      // min/max are NOT NULL in the Gladys database, binary and text features included.
      min: spec.min ?? 0,
      max: spec.max ?? 1,
      ...(spec.step ? { step: spec.step } : {}),
      read_only: !spec.write,
      has_feedback: spec.feedback !== false,
      keep_history: spec.keepHistory ?? true,
      ...(spec.options ? { supported_options: spec.options(language) } : {}),
    })),
  };
}

/** The current values of a device: `[{ id, value: { state } | { text } }]`. */
export function deviceStates(gladys, appliance, plan, reading, language) {
  if (!reading) {
    return [];
  }
  const ids = deviceIds(gladys, appliance.said);
  const states = [];
  for (const spec of plan.specs) {
    const value = spec.read?.(reading, language);
    if (value) {
      states.push({ id: ids.feature(spec.key), key: spec.key, value });
    }
  }
  return states;
}
