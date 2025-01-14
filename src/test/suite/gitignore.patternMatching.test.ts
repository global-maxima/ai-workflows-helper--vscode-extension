import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';

import { GitIgnoreHandler } from '../../extension/utils/gitignore/handler';
import { GitIgnoreError, GitIgnoreConfig } from '../../extension/utils/gitignore/types';
import { debugLog } from './utils';


suite('GitIgnore Pattern Matching Test', () => {
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
    const gitignorePath = path.join(tempWorkspacePath, '.gitignore');
    fs.writeFileSync(gitignorePath, gitignoreContent.trim());
    debugLog('Workspace Path', tempWorkspacePath);
    debugLog('GitIgnore Content', fs.readFileSync(gitignorePath, 'utf8'));
  });

  setup(() => {
    workspaceRoot = tempWorkspacePath;
    const config: GitIgnoreConfig = {
      enabled: true,
      respectGlobalIgnore: true,
      respectNestedIgnores: true,
      cacheTimeout: 5000
    };
    debugLog('Test Configuration', config);
    handler = new GitIgnoreHandler(config);
  });

  test('should correctly match node_modules pattern', async () => {
    const testPath = 'node_modules/file.js';
    const absolutePath = path.join(workspaceRoot, testPath);

    debugLog('Test Path Details', {
      testPath,
      absolutePath,
      normalized: path.normalize(absolutePath).replace(/\\/g, '/'),
      workspaceRoot: path.normalize(workspaceRoot).replace(/\\/g, '/'),
      relative: path.relative(workspaceRoot, absolutePath).replace(/\\/g, '/')
    });

    // Debug cache state before check
    debugLog('Cache State Before', {
      handler: util.inspect(handler, { depth: 3 })
    });

    const result = await handler.isIgnored(workspaceRoot, absolutePath);
    debugLog('Ignore Check Result', {
      result,
      inputPath: absolutePath,
      workspaceRoot
    });

    // Debug the internal state after check
    debugLog('Internal State', {
      handler: util.inspect(handler, { depth: 3 })
    });

    assert.strictEqual(
      result.ignored,
      true,
      `Path ${testPath} should be ignored\nFull result: ${util.inspect(result)}`
    );
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
});