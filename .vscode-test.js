// .vscode-test.js
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'out/test/**/*.test.js',
  workspaceFolder: './test-workspace',
  version: 'stable',    // or 'insiders'
  mocha: {
    ui: 'tdd',
    color: true
  },
  launchArgs: [
    '--disable-extensions'
  ]
});
