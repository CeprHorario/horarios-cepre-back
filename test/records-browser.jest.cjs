module.exports = {
  ...require('../jest.config.cjs'),
  rootDir: '..',
  // Do not let the normal Jest setup replace NODE_ENV/DATABASE_URL before the safety gate.
  setupFiles: [],
  testMatch: ['<rootDir>/test/records-browser.harness.e2e-spec.ts'],
};
