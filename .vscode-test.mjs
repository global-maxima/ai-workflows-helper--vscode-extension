// Added 2025-01-13: New test configuration file for VS Code CLI test runner
import { defineConfig } from '@vscode/test-cli';
import path from 'path';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  workspaceFolder: path.resolve('test-workspace'),
  mocha: {
    ui: 'tdd',
    timeout: 10000,
    color: true
  }
});