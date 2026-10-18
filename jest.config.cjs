module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.e2e-spec.ts', '<rootDir>/test/**/*.e2e-spec.cjs'],
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { tsconfig: { module: 'CommonJS', moduleResolution: 'Bundler' } },
    ],
  },
  moduleNameMapper: {
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@database/(.*)$': '<rootDir>/src/database/$1',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/generated/**',
    '!src/main.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: 'coverage',
};
