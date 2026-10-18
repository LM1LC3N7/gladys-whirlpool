// -----------------------------------------------------------------------------
// Whirlpool appliances -> readings (pure). The appliance kind comes from the
// DATA_MODEL_KEY of the appliance lists, the readings from the attributes of
// GET /api/v1/appliance/<SAID>, with the names and values of
// whirlpool-sixth-sense (MIT): httpapi/appliancesmanager.py (kinds),
// httpapi/washer.py, httpapi/dryer.py, httpapi/oven.py and
// httpapi/aircon.py (attributes). Every attribute value is a string; a value
// that is absent or not what the reference expects reads as unknown (null).
// -----------------------------------------------------------------------------

/** The cooking data models the reference reads as ovens (appliancesmanager.py). */
export const OVEN_MODELS = [
  'cooking_minerva',
  'cooking_vsi',
  'cooking_u2',
  'ddm_cooking_bio_std_tourmaline_v2',
  'ddm_cooking_bio_self_clean_tourmaline_v2',
  'ddm_cooking_bio_g3evo_pyro_bk_v1',
  'ddm_cooking_bio_self_clean_meat_probe_tourmaline_bk_v1',
  'ddm_cooking_bio_self_clean_steam_tourmaline_v2',
  'ddm_cooking_bi_mwo_self_clean_steam_tourmaline_v2',
  'ddm_cooking_bio_std_meat_probe_indigo_v2',
  'ddm_cooking_bio_std_meat_probe_indigo_bk_v2',
  'ddm_cooking_ka_trs_bio_single_v1',
];

/** 'aircon' | 'dryer' | 'washer' | 'oven' | undefined, in the order of the reference. */
export function kindOf(dataModel) {
  const model = String(dataModel ?? '').toLowerCase();
  if (model.includes('airconditioner')) {
    return 'aircon';
  }
  if (model.includes('dryer')) {
    return 'dryer';
  }
  if (model.includes('washer')) {
    return 'washer';
  }
  if (OVEN_MODELS.some((m) => model.includes(m))) {
    return 'oven';
  }
  return undefined;
}

const INTEGER = /^-?\d{1,9}$/;

/** An attribute as an integer, null when absent or not an integer. */
export const int = (attrs, name) => {
  const value = attrs.get(name);
  return value !== undefined && INTEGER.test(value.trim()) ? Number(value.trim()) : null;
};

/** "1" -> true, "0" -> false, anything else null (appliance.py attr_value_to_bool, strict). */
export const bool = (attrs, name) => {
  const value = attrs.get(name)?.trim();
  if (value === '1') {
    return true;
  }
  return value === '0' ? false : null;
};

/** The `Online` attribute (appliance.py get_online). */
export const onlineOf = (attrs) => bool(attrs, 'Online');

// --- Washers and dryers ------------------------------------------------------

export const LAUNDRY_ATTRS = {
  machineState: 'Cavity_CycleStatusMachineState',
  timeRemaining: 'Cavity_TimeStatusEstTimeRemaining',
  doorOpen: 'Cavity_OpStatusDoorOpen',
  cycleName: 'Cavity_CycleSetCycleName',
  washerCycle: 'WashCavity_CycleSetCycleSelect',
  dryerCycle: 'DryCavity_CycleSetCycleSelect',
};

/**
 * MachineState of washer.py / dryer.py (0..19) -> the state shown in Gladys.
 * Several close states share one value: the three delays, the two pauses,
 * the two errors, the diagnostic and demo modes.
 */
export const MACHINE_STATES = {
  0: 'standby',
  1: 'setting',
  2: 'delayed',
  3: 'delayed',
  4: 'delayed',
  5: 'paused',
  6: 'paused',
  7: 'running',
  8: 'finishing',
  9: 'error',
  10: 'complete',
  11: 'power_failure',
  12: 'service',
  13: 'service',
  14: 'service',
  15: 'service',
  16: 'service',
  17: 'error',
  18: 'starting',
  19: 'cancelled',
};

/** Every value of the state feature, in display order ("unknown": a code the reference does not list). */
export const LAUNDRY_STATE_VALUES = [
  'standby',
  'setting',
  'delayed',
  'running',
  'finishing',
  'paused',
  'complete',
  'cancelled',
  'error',
  'power_failure',
  'service',
  'starting',
  'unknown',
];

/** A cycle is under way in these states: its phase and time remaining mean something. */
export const ACTIVE_STATES = new Set(['running', 'finishing', 'paused', 'delayed']);

/** The cycle status flags of washer.py and dryer.py, in the order they are checked. */
export const PHASES = {
  washer: [
    ['sensing', 'WashCavity_CycleStatusSensing'],
    ['filling', 'WashCavity_CycleStatusFilling'],
    ['soaking', 'WashCavity_CycleStatusSoaking'],
    ['washing', 'WashCavity_CycleStatusWashing'],
    ['rinsing', 'WashCavity_CycleStatusRinsing'],
    ['spinning', 'WashCavity_CycleStatusSpinning'],
  ],
  dryer: [
    ['sensing', 'DryCavity_CycleStatusSensing'],
    ['steaming', 'DryCavity_CycleStatusSteaming'],
    ['drying', 'DryCavity_CycleStatusDrying'],
    ['cooling', 'DryCavity_CycleStatusCoolDown'],
  ],
};

/** The dryer cycles of dryer.py (Cycle), by DryCavity_CycleSetCycleSelect. */
export const DRYER_CYCLES = {
  1: 'regular',
  2: 'heavy_duty',
  3: 'denim',
  4: 'delicates',
  5: 'wrinkle_control',
  6: 'bulky_items',
  7: 'quick_dry',
  9: 'sanitize',
  10: 'steam_refresh',
  11: 'timed_dry',
  13: 'colors_brights',
  15: 'towels',
  16: 'whites',
  41: 'normal',
};

/**
 * One reading of a washer or a dryer:
 * { online, state, phase, cycle: { name } | { key } | { number } | null, remainingMinutes, doorOpen }.
 */
export function readLaundry(kind, attrs) {
  const code = int(attrs, LAUNDRY_ATTRS.machineState);
  const state = code === null ? null : (MACHINE_STATES[code] ?? 'unknown');
  const active = state !== null && ACTIVE_STATES.has(state);
  let phase = null;
  if (state !== null) {
    phase = 'none';
    if (active) {
      for (const [name, attribute] of PHASES[kind] ?? []) {
        if (bool(attrs, attribute) === true) {
          phase = name;
          break;
        }
      }
    }
  }
  const seconds = int(attrs, LAUNDRY_ATTRS.timeRemaining);
  let remainingMinutes = null;
  if (state !== null && seconds !== null && seconds >= 0) {
    remainingMinutes = active ? Math.ceil(seconds / 60) : 0;
  }
  const door = bool(attrs, LAUNDRY_ATTRS.doorOpen);
  return {
    online: onlineOf(attrs),
    state,
    phase,
    cycle: cycleOf(kind, attrs),
    remainingMinutes,
    doorOpen: door,
  };
}

function cycleOf(kind, attrs) {
  const name = attrs.get(LAUNDRY_ATTRS.cycleName)?.trim();
  if (name) {
    return { name };
  }
  const number = int(
    attrs,
    kind === 'dryer' ? LAUNDRY_ATTRS.dryerCycle : LAUNDRY_ATTRS.washerCycle,
  );
  if (number === null || number < 0) {
    return null;
  }
  if (kind === 'dryer' && DRYER_CYCLES[number]) {
    return { key: DRYER_CYCLES[number] };
  }
  return { number };
}

// --- Ovens -----------------------------------------------------------------------

export const CAVITIES = { upper: 'OvenUpperCavity', lower: 'OvenLowerCavity' };

/** CavityState of oven.py, by <cavity>_OpStatusState; 4 is "not present". */
export const CAVITY_STATES = { 0: 'standby', 1: 'preheating', 2: 'cooking' };
export const CAVITY_NOT_PRESENT = 4;
export const OVEN_STATE_VALUES = ['standby', 'preheating', 'cooking', 'unknown'];

/** The cavity exists: its state is known and not "not present" (oven.py get_oven_cavity_exists). */
export function hasCavity(attrs, cavity) {
  const code = int(attrs, `${CAVITIES[cavity]}_OpStatusState`);
  return code !== null && code !== CAVITY_NOT_PRESENT;
}

/**
 * One cavity: { state, temperature (°C), doorOpen }. Temperatures come in
 * tenths of a degree Celsius; 0 means none (oven.py get_temp).
 */
export function readCavity(attrs, cavity) {
  const prefix = CAVITIES[cavity];
  const code = int(attrs, `${prefix}_OpStatusState`);
  const raw = int(attrs, `${prefix}_DisplStatusDisplayTemp`);
  return {
    state: code === null || code === CAVITY_NOT_PRESENT ? null : (CAVITY_STATES[code] ?? 'unknown'),
    temperature: raw === null || raw === 0 ? null : raw / 10,
    doorOpen: bool(attrs, `${prefix}_OpStatusDoorOpen`),
  };
}

export function readOven(attrs) {
  return {
    online: onlineOf(attrs),
    upper: readCavity(attrs, 'upper'),
    lower: readCavity(attrs, 'lower'),
  };
}

// --- Air conditioners ----------------------------------------------------------

export const AC_ATTRS = {
  statusMode: 'Cavity_OpStatusMode',
  setMode: 'Cavity_OpSetMode',
  displayTemp: 'Sys_OpStatusDisplayTemp',
  displayHumidity: 'Sys_OpStatusDisplayHumidity',
  power: 'Sys_OpSetPowerOn',
  targetTemp: 'Sys_OpSetTargetTemp',
};

/** Gladys AC_MODE (server/utils/constants.js): AUTO 0, COOLING 1, HEATING 2, DRYING 3, FAN 4. */
export const AC_MODE = { AUTO: 0, COOLING: 1, HEATING: 2, FAN: 4 };

/** Gladys AC mode -> the Cavity_OpSetMode value of aircon.py (6th Sense mode as AUTO). */
export const AC_SET_MODE = { 0: '4', 1: '1', 2: '3', 4: '2' };

/** aircon.py get_mode: the status mode (6th Sense variants included); 6th Sense set mode is AUTO. */
export function acModeOf(attrs) {
  if (attrs.get(AC_ATTRS.setMode)?.trim() === '4') {
    return AC_MODE.AUTO;
  }
  const status = attrs.get(AC_ATTRS.statusMode)?.trim();
  if (status === '1' || status === '7') {
    return AC_MODE.COOLING;
  }
  if (status === '3' || status === '6') {
    return AC_MODE.HEATING;
  }
  if (status === '2' || status === '5') {
    return AC_MODE.FAN;
  }
  return null;
}

const tenths = (attrs, name) => {
  const raw = int(attrs, name);
  return raw === null ? null : raw / 10;
};

export function readAircon(attrs) {
  const humidity = int(attrs, AC_ATTRS.displayHumidity);
  return {
    online: onlineOf(attrs),
    power: bool(attrs, AC_ATTRS.power),
    mode: acModeOf(attrs),
    target: tenths(attrs, AC_ATTRS.targetTemp),
    temperature: tenths(attrs, AC_ATTRS.displayTemp),
    humidity: humidity !== null && humidity >= 0 && humidity <= 100 ? humidity : null,
  };
}

/** The reading of an appliance of `kind`. */
export function readingOf(kind, attrs) {
  switch (kind) {
    case 'washer':
    case 'dryer':
      return readLaundry(kind, attrs);
    case 'oven':
      return readOven(attrs);
    case 'aircon':
      return readAircon(attrs);
    default:
      return undefined;
  }
}
