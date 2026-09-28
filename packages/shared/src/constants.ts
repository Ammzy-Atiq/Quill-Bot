export const PRODUCT_NAME = 'QUILL GUARD';
export const PRODUCT_AUTHOR = 'Atiq Ur Rahman';

/** Every interactive component custom_id starts with this prefix: `qg:<module>:<action>[:arg...]`. */
export const CUSTOM_ID_PREFIX = 'qg';

/** Discord snowflake validation (17–20 digits). */
export const SNOWFLAKE_REGEX = /^\d{17,20}$/;

/** Hard Discord limits that the UI kit and config validation respect. */
export const DISCORD_LIMITS = {
  /** Max components (including nested) in one Components V2 message. */
  v2ComponentsPerMessage: 40,
  /** Max characters across all text displays in one message. */
  v2TextCharacters: 4000,
  /** Max top-level components in a modal. */
  modalComponents: 5,
  selectOptions: 25,
  buttonsPerRow: 5,
  customIdLength: 100,
  timeoutMaxSeconds: 28 * 24 * 60 * 60,
  banDeleteMessageMaxSeconds: 7 * 24 * 60 * 60,
} as const;
