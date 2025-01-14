/*
 * File Context:
 */

import * as assert from 'assert';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';

import { GitIgnoreHandler } from '../../extension/utils/gitignore/handler';
import { GitIgnoreError, GitIgnoreConfig } from '../../extension/utils/gitignore/types';
import { WorkspacePath } from '../../extension/utils/gitignore/workspacePath';

suite('GitIgnore Test Suite', () => {
  let handler: GitIgnoreHandler;
  let workspaceRoot: string;
  let tempWorkspacePath: string;

  suiteSetup(async () => {
    // Create temporary workspace
    tempWorkspacePath = path.join(
      os.tmpdir(),
      `test-workspace-${Math.random().toString(36).substring(7)}`
    );
    fs.mkdirSync(tempWorkspacePath, { recursive: true });

    // Create test workspace structure
    fs.mkdirSync(path.join(tempWorkspacePath, 'src'), { recursive: true });
    fs.mkdirSync(path.join(tempWorkspacePath, 'node_modules'), { recursive: true });
    fs.mkdirSync(path.join(tempWorkspacePath, 'build'), { recursive: true });

    // Create a test .gitignore file
    const gitignoreContent = `
      node_modules/
      build/
      .env
      *.log
    `;
    fs.writeFileSync(path.join(tempWorkspacePath, '.gitignore'), gitignoreContent.trim());

    // Open the temporary workspace
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(tempWorkspacePath));

    // Wait for workspace to be fully initialized
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  setup(() => {
    // Get the workspace folder after it's been initialized
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, 'Workspace folder should be available');
    workspaceRoot = workspaceFolder.uri.fsPath;

    const config: GitIgnoreConfig = {
      enabled: true,
      respectGlobalIgnore: true,
      respectNestedIgnores: true,
      cacheTimeout: 5000
    };
    handler = new GitIgnoreHandler(config);
  });

  teardown(() => {
    handler.dispose();
  });

  suiteTeardown(async () => {
    // Clean up temporary workspace
    if (fs.existsSync(tempWorkspacePath)) {
      fs.rmSync(tempWorkspacePath, { recursive: true, force: true });
    }

    // Close the workspace
    await vscode.commands.executeCommand('workbench.action.closeFolder');
  });

  // Helper function to normalize paths for testing
  function normalizePath(inputPath: string): string {
    // Ensure consistent forward slashes for testing
    return inputPath.replace(/\\/g, '/');
  }

  test('GitIgnoreHandler - Basic Pattern Matching', async () => {
    // Use normalized paths in test cases
    const testCases = [
      { path: 'node_modules/file.js', shouldIgnore: true },
      { path: 'src/file.ts', shouldIgnore: false },
      { path: 'build/output.log', shouldIgnore: true },
      { path: '.env', shouldIgnore: true }
    ];

    for (const testCase of testCases) {
      const result = await handler.shouldIgnore(
        path.join(workspaceRoot, testCase.path)
      );
      assert.strictEqual(
        result,
        testCase.shouldIgnore,
        `Path ${testCase.path} should ${testCase.shouldIgnore ? 'be' : 'not be'} ignored`
      );
    }
  });

  test('GitIgnoreHandler - Nested Patterns', async () => {
    // Use normalized paths for nested patterns
    const nestedPath = normalizePath(path.join('src', 'nested', 'temp.log'));
    const result = await handler.shouldIgnore(
      path.join(workspaceRoot, nestedPath)
    );
    assert.strictEqual(result, true, 'Nested .gitignore patterns should be respected');
  });

  test('GitIgnoreHandler - Cache Management', async () => {
    const testPath = normalizePath(path.join('node_modules', 'test.js'));
    const firstResult = await handler.shouldIgnore(
      path.join(workspaceRoot, testPath)
    );
    handler.clearCache();
    const secondResult = await handler.shouldIgnore(
      path.join(workspaceRoot, testPath)
    );
    assert.strictEqual(firstResult, secondResult, 'Cache clear should not affect results');
  });

  test('GitIgnoreHandler - Error Handling', async () => {
    try {
      // Attempt to process an invalid path
      await handler.shouldIgnore('');
      assert.fail('Should throw error for invalid path');
    } catch (error) {
      assert.ok(error instanceof GitIgnoreError);
    }
  });

  test('Integration - FileSystemManager with GitIgnore', async () => {
    // Use normalized paths for integration test
    const testFiles = [
      'src/valid.ts',
      'node_modules/ignored.js',
      'build/output.log'
    ].map(p => normalizePath(p));

    const results = await Promise.all(
      testFiles.map(file => handler.shouldIgnore(path.join(workspaceRoot, file)))
    );

    const ignoredCount = results.filter(r => r).length;
    assert.strictEqual(ignoredCount, 2, 'Should ignore 2 out of 3 test files');
  });

  test('Integration - WorkspacePath with GitIgnore', async () => {
    const workspacePath = new WorkspacePath(workspaceRoot);
    const testPath = normalizePath(path.join('src', 'test.ts'));
    const absolutePath = await workspacePath.toAbsolute(testPath);
    const relativePath = await workspacePath.toRelative(absolutePath);

    assert.strictEqual(
      normalizePath(relativePath),
      'src/test.ts',
      'Path conversion should maintain correct format'
    );
  });

  test('Integration - Batch Operations', async () => {
    // Use normalized paths for batch operations
    const testFiles = [
      'src/file1.ts',
      'node_modules/file2.js',
      'dist/file3.js',
      '.env'
    ].map(p => normalizePath(p));

    const results = await handler.isIgnoredBatch(
      workspaceRoot,
      testFiles.map(f => path.join(workspaceRoot, f))
    );

    const ignoredCount = Array.from(results.values()).filter(r => r.ignored).length;
    assert.strictEqual(ignoredCount, 3, 'Batch operation should identify correct number of ignored files');
  });

  test('Edge Cases - Empty and Special Patterns', async () => {
    // Use normalized paths for edge cases
    const testCases = [
      { path: '.', shouldIgnore: false },
      { path: '..', shouldIgnore: false },
      { path: '.git/objects/pack', shouldIgnore: true },
      { path: 'node_modules', shouldIgnore: true }
    ];

    for (const testCase of testCases) {
      const normalizedTestPath = normalizePath(testCase.path);
      const result = await handler.shouldIgnore(
        path.join(workspaceRoot, normalizedTestPath)
      );
      assert.strictEqual(
        result,
        testCase.shouldIgnore,
        `Path ${normalizedTestPath} should ${testCase.shouldIgnore ? 'be' : 'not be'} ignored`
      );
    }
  });

  test('Performance - Large Directory Scan', async () => {
    // Generate a large number of test paths
    const testPaths = Array.from({ length: 1000 }, (_, i) =>
      normalizePath(path.join(
        i % 2 ? 'node_modules' : 'src',
        `file${i}.${i % 2 ? 'js' : 'ts'}`
      ))
    );

    const startTime = process.hrtime();
    const results = await handler.isIgnoredBatch(
      workspaceRoot,
      testPaths.map(p => path.join(workspaceRoot, p))
    );
    const [seconds, nanoseconds] = process.hrtime(startTime);
    const totalTime = seconds * 1000 + nanoseconds / 1e6; // Convert to milliseconds

    const ignoredCount = Array.from(results.values()).filter(r => r.ignored).length;
    assert.strictEqual(ignoredCount, 500, 'Should ignore half of the test files');
    assert.ok(totalTime < 1000, 'Batch operation should complete within 1 second');
  });
});
