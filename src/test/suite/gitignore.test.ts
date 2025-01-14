// src/test/suite/gitignore.test.ts

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';

import { GitIgnoreHandler } from '../../extension/utils/gitignore/handler';
import { GitIgnoreError, GitIgnoreConfig } from '../../extension/utils/gitignore/types';
import { debugLog } from './utils';


suite('GitIgnore Test Suite', () => {
  let handler: GitIgnoreHandler;
  let workspaceRoot: string;
  let tempWorkspacePath: string;

  suiteSetup(async () => {
    debugLog('Test Setup', 'Creating temporary workspace');
    tempWorkspacePath = path.join(
      os.tmpdir(),
      `test-workspace-${Math.random().toString(36).substring(7)}`
    );
    fs.mkdirSync(tempWorkspacePath, { recursive: true });

    fs.mkdirSync(path.join(tempWorkspacePath, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempWorkspacePath, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(tempWorkspacePath, 'build'), { recursive: true });

    const gitignoreContent = `
      node_modules/
      build/
      .env
      *.log
    `;
    fs.writeFileSync(path.join(tempWorkspacePath, '.gitignore'), gitignoreContent.trim());
    debugLog('Workspace Path', tempWorkspacePath);
    debugLog('GitIgnore Content', gitignoreContent.trim());
  });

  setup(() => {
    workspaceRoot = tempWorkspacePath;
    const config: GitIgnoreConfig = {
      enabled: true,
      respectGlobalIgnore: true,
      respectNestedIgnores: true,
      cacheTimeout: 5000
    };
    handler = new GitIgnoreHandler(config);
    debugLog('Test Configuration', config);
  });

  teardown(() => {
    debugLog('Test Teardown', 'Disposing handler');
    handler.dispose();
  });

  suiteTeardown(() => {
    if (fs.existsSync(tempWorkspacePath)) {
      debugLog('Suite Teardown', `Removing workspace: ${tempWorkspacePath}`);
      fs.rmSync(tempWorkspacePath, { recursive: true, force: true });
    }
  });

  function normalizePath(inputPath: string): string {
    const normalized = inputPath.replace(/\\/g, '/');
    debugLog('Path Normalization', { input: inputPath, normalized });
    return normalized;
  }

  test('should correctly match basic gitignore patterns', async () => {
    const testCases = [
      { path: 'node_modules/file.js', shouldIgnore: true },
      { path: 'src/file.ts', shouldIgnore: false },
      { path: 'build/output.log', shouldIgnore: true },
      { path: '.env', shouldIgnore: true }
    ];

    debugLog('Basic Pattern Test Cases', testCases);

    for (const testCase of testCases) {
      const absolutePath = path.join(workspaceRoot, testCase.path);
      debugLog('Testing Path', { relative: testCase.path, absolute: absolutePath });

      const result = await handler.isIgnored(workspaceRoot, absolutePath);
      debugLog('Ignore Check Result', { path: testCase.path, result });

      assert.strictEqual(
        result.ignored,
        testCase.shouldIgnore,
        `Path ${testCase.path} should ${testCase.shouldIgnore ? 'be' : 'not be'} ignored`
      );
    }
  });

  test('should respect nested gitignore patterns', async () => {
    const nestedPath = normalizePath(path.join('src', 'nested', 'temp.log'));
    const absolutePath = path.join(workspaceRoot, nestedPath);
    debugLog('Nested Pattern Test', {
      nestedPath,
      absolutePath,
      workspaceRoot
    });

    const result = await handler.isIgnored(workspaceRoot, absolutePath);
    debugLog('Nested Pattern Result', result);

    assert.strictEqual(result.ignored, true, 'Nested .gitignore patterns should be respected');
  });

  test('should maintain consistent results after cache clear', async () => {
    const testPath = normalizePath(path.join('node_modules', 'test.js'));
    const absolutePath = path.join(workspaceRoot, testPath);

    debugLog('Cache Test Paths', { testPath, absolutePath });

    const firstResult = await handler.isIgnored(workspaceRoot, absolutePath);
    debugLog('First Check Result', firstResult);

    handler.clearCache();
    debugLog('Cache Cleared', 'Checking again');

    const secondResult = await handler.isIgnored(workspaceRoot, absolutePath);
    debugLog('Second Check Result', secondResult);

    assert.strictEqual(
      firstResult.ignored,
      secondResult.ignored,
      'Cache clear should not affect results'
    );
  });

  test('should handle invalid paths appropriately', async () => {
    debugLog('Invalid Path Test', 'Starting');
    try {
      await handler.isIgnored(workspaceRoot, '');
      assert.fail('Should throw error for invalid path');
    } catch (error) {
      debugLog('Invalid Path Error', error);
      assert.ok(error instanceof GitIgnoreError);
    }
  });

  test('should handle batch operations efficiently', async () => {
    const testPaths = Array.from({ length: 100 }, (_, i) =>
      normalizePath(
        path.join(
          i % 2 ? 'node_modules' : 'src',
          `file${i}.${i % 2 ? 'js' : 'ts'}`
        )
      )
    );
    debugLog('Batch Test Paths', testPaths);

    const absolutePaths = testPaths.map(p => path.join(workspaceRoot, p));
    const startTime = process.hrtime();

    const results = await handler.isIgnoredBatch(workspaceRoot, absolutePaths);
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const totalTime = seconds * 1000 + nanoseconds / 1e6;

    debugLog('Batch Operation Results', {
      totalTime,
      results: Object.fromEntries(results)
    });

    const ignoredCount = Array.from(results.values()).filter(r => r.ignored).length;
    assert.strictEqual(ignoredCount, 50, 'Should ignore half of the test files');
    assert.ok(totalTime < 1000, 'Batch operation should complete within 1 second');
  });
});