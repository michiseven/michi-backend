module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  setupFiles: ['reflect-metadata'],
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/database/**'],
  coverageDirectory: 'coverage',
  testEnvironment: 'node',
};
