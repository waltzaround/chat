/** The app's version, shown to clients through /api/instance. Keep in step with package.json. */
export const APP_VERSION = "0.1.0";

/**
 * Bumped when the API changes in a way older native apps can't handle. Apps check it
 * on connect and ask people to update when they're behind.
 */
export const API_VERSION = 1;
