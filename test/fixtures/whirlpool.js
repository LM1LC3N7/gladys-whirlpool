// -----------------------------------------------------------------------------
// Made-up answers of the Whirlpool cloud, shaped like the fixtures of
// whirlpool-sixth-sense (tests/data: owned_appliances.json,
// shared_appliances.json, washer_data.json, dryer_data.json, oven_data.json,
// aircon_data.json), trimmed to the attributes the integration reads plus a
// few others. No real account, appliance or address.
// -----------------------------------------------------------------------------

export const EMAIL = 'someone@example.com';
export const PASSWORD = 'pass-WORD-123';
export const ACCOUNT_ID = '12345';

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const NOW = Date.parse('2026-10-18T10:00:00Z');

export const SAIDS = {
  washer: 'SAIDWASHER1',
  dryer: 'SAIDDRYER1',
  oven: 'SAIDOVEN1',
  aircon: 'SAIDAIRCON1',
  fridge: 'SAIDFRIDGE1',
  sharedOven: 'SAIDOVEN2',
};

export const owned = () => ({
  KEY1: {
    legacyAppliance: [
      {
        APPLIANCE_NAME: 'Washer',
        SAID: SAIDS.washer,
        SERIAL: 'CC00000000',
        DATA_MODEL_KEY: 'DDM_LAUNDRY_VMAX20_WHIRLPOOL_WASHER8_V2',
        CATEGORY_NAME: 'FabricCare',
        MODEL_NO: 'WTW8127LW1',
      },
      {
        APPLIANCE_NAME: 'Dryer',
        SAID: SAIDS.dryer,
        SERIAL: 'MC0000000',
        DATA_MODEL_KEY: 'DDM_LAUNDRY_VMAX20_MAYTAG_DRYER_6_V1',
        CATEGORY_NAME: 'FabricCare',
        MODEL_NO: 'MGD6230HW3',
      },
      {
        APPLIANCE_NAME: 'Oven',
        SAID: SAIDS.oven,
        SERIAL: '000000000000',
        DATA_MODEL_KEY: 'DDM_COOKING_BIO_SELF_CLEAN_TOURMALINE_V2',
        CATEGORY_NAME: 'Cooking',
        MODEL_NO: '000000000000',
      },
      {
        SAID: SAIDS.aircon,
        APPLIANCE_NAME: 'Air Conditioner',
        DATA_MODEL_KEY: 'airconditioner',
        CATEGORY_NAME: 'Climate',
        MODEL_NO: 'WAC1234XX1',
        SERIAL: 'AC00000000',
      },
      {
        SAID: SAIDS.fridge,
        APPLIANCE_NAME: 'Beer fridge',
        DATA_MODEL_KEY: 'ddm_ted_refrigerator_v12',
        CATEGORY_NAME: 'Climate',
        MODEL_NO: 'CoolMyBeer',
        SERIAL: 'FR00000000',
      },
    ],
    tsAppliance: [],
  },
});

export const shared = () => ({
  sharedAppliances: [
    {
      shareId: 1,
      appliances: [
        {
          APPLIANCE_NAME: 'Oven 2',
          SAID: SAIDS.sharedOven,
          DATA_MODEL_KEY: 'DDM_COOKING_BIO_SELF_CLEAN_TOURMALINE_V2',
          CATEGORY_NAME: 'Cooking',
          MODEL_NO: '000000000000',
          SERIAL: '000000000000',
        },
      ],
      tsAppliances: null,
    },
  ],
});

/** washer_data.json DATA1, trimmed: in standby, door open. */
export const washer = () => ({
  Online: '1',
  Cavity_CycleStatusMachineState: '0',
  Cavity_TimeStatusEstTimeRemaining: '4080',
  Cavity_OpStatusDoorOpen: '1',
  Cavity_OpStatusDoorLocked: '0',
  Cavity_CycleSetCycleName: '',
  WashCavity_CycleSetCycleSelect: '88',
  WashCavity_CycleStatusSensing: '0',
  WashCavity_CycleStatusFilling: '0',
  WashCavity_CycleStatusSoaking: '0',
  WashCavity_CycleStatusWashing: '0',
  WashCavity_CycleStatusRinsing: '0',
  WashCavity_CycleStatusSpinning: '0',
  WashCavity_OpStatusBulkDispense1Level: '4',
  XCat_OdometerStatusCycleCount: '98',
});

/** A dryer drying a "Towels" cycle. */
export const dryer = () => ({
  Online: '1',
  Cavity_CycleStatusMachineState: '7',
  Cavity_TimeStatusEstTimeRemaining: '1830',
  Cavity_OpStatusDoorOpen: '0',
  DryCavity_CycleSetCycleSelect: '15',
  DryCavity_CycleStatusSensing: '0',
  DryCavity_CycleStatusDrying: '1',
  DryCavity_CycleStatusCoolDown: '0',
  DryCavity_CycleStatusSteaming: '0',
});

/** oven_data.json DATA1, trimmed: the upper cavity preheating, no lower cavity. */
export const oven = () => ({
  Online: '1',
  OvenUpperCavity_OpStatusState: '1',
  OvenUpperCavity_DisplStatusDisplayTemp: '377',
  OvenUpperCavity_CycleSetTargetTemp: '1766',
  OvenUpperCavity_OpStatusDoorOpen: '0',
  OvenUpperCavity_CycleSetCommonMode: '2',
  OvenLowerCavity_OpStatusState: '4',
  OvenLowerCavity_DisplStatusDisplayTemp: '4',
  OvenLowerCavity_OpStatusDoorOpen: '4',
  Sys_OperationSetControlLock: '0',
});

/** aircon_data.json DATA1: off, heating mode, 23 °C, setpoint 30 °C. */
export const aircon = () => ({
  Online: '1',
  Cavity_OpSetFanSpeed: '0',
  Cavity_OpSetHorzLouverSwing: '1',
  Cavity_OpSetMode: '3',
  Cavity_OpStatusMode: '3',
  Sys_OpSetPowerOn: '0',
  Sys_OpSetTargetTemp: '300',
  Sys_OpStatusDisplayHumidity: '56',
  Sys_OpStatusDisplayTemp: '230',
});

export const fridge = () => ({ Online: '1', Sys_OpSetMaxCool: '0' });

export const allData = () => ({
  [SAIDS.washer]: washer(),
  [SAIDS.dryer]: dryer(),
  [SAIDS.oven]: oven(),
  [SAIDS.aircon]: aircon(),
  [SAIDS.fridge]: fridge(),
  [SAIDS.sharedOven]: { ...oven(), OvenUpperCavity_OpStatusState: '0' },
});
