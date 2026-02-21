/**
 * Feature Toggle Configuration
 * Central place to enable/disable features across the app
 */

// Main page features (production-ready)
export const MAIN_FEATURES = {
  SCENARIOS_ENABLED: true,
  PLAYOFFS_ENABLED: true,
  HEAD_TO_HEAD_ENABLED: true,
};

/**
 * Check if a feature is enabled
 * @param {string} featureName - Name of the feature to check
 * @param {Object} config - Feature config object (SANDBOX_FEATURES or MAIN_FEATURES)
 * @returns {boolean}
 */
export function isFeatureEnabled(featureName, config) {
  return config[featureName] === true;
}

/**
 * Check if any features are enabled in a config
 * @param {Object} config - Feature config object
 * @returns {boolean}
 */
export function hasAnyFeaturesEnabled(config) {
  return Object.values(config).some(value => value === true);
}

/**
 * Get list of enabled features
 * @param {Object} config - Feature config object
 * @returns {Array<string>}
 */
export function getEnabledFeatures(config) {
  return Object.keys(config).filter(key => config[key] === true);
}
