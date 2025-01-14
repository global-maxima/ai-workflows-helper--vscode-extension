import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as util from 'util';

import { GitIgnoreHandler } from '../../extension/utils/gitignore/handler';
import { GitIgnoreError, GitIgnoreConfig } from '../../extension/utils/gitignore/types';

suite('GitIgnore Pattern Matching Test', () => {
  let handler: GitIgnoreHandler;
  let workspaceRoot: string;
  let tempWorkspacePath: string;

  suiteSetup(async () => {
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
  });

  test('should correctly match node_modules pattern', async () => {
    const testPath = 'node_modules/file.js';
    const absolutePath = path.join(workspaceRoot, testPath);


    const result = await handler.isIgnored(workspaceRoot, absolutePath);

    assert.strictEqual(
      result.ignored,
      true,
      `Path ${testPath} should be ignored\nFull result: ${util.inspect(result)}`
    );
  });

  teardown(() => {
    handler.dispose();
  });

  suiteTeardown(() => {
    if (fs.existsSync(tempWorkspacePath)) {
      fs.rmSync(tempWorkspacePath, { recursive: true, force: true });
    }
  });
});