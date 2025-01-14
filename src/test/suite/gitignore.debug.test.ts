import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { GitIgnoreHandler } from '../../extension/utils/gitignore/handler';
import { GitIgnoreError, GitIgnoreConfig } from '../../extension/utils/gitignore/types';

suite('GitIgnore Debug Suite', () => {
  let handler: GitIgnoreHandler;
  let workspaceRoot: string;
  let tempWorkspacePath: string;

  suiteSetup(async () => {
    // Debug output for test setup
    console.log('\nTest Setup:');

    tempWorkspacePath = path.join(
      os.tmpdir(),
      `test-workspace-${Math.random().toString(36).substring(7)}`
    );
    console.log(`Creating workspace at: ${tempWorkspacePath}`);

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
    console.log(`Created .gitignore with content:\n${gitignoreContent}`);

    // Verify file was written correctly
    const actualContent = fs.readFileSync(gitignorePath, 'utf8');
    console.log(`Actual .gitignore content:\n${actualContent}`);
  });

  setup(() => {
    console.log('\nTest Configuration:');
    workspaceRoot = tempWorkspacePath;
    const config: GitIgnoreConfig = {
      enabled: true,
      respectGlobalIgnore: true,
      respectNestedIgnores: true,
      cacheTimeout: 5000
    };
    console.log('Config:', config);
    handler = new GitIgnoreHandler(config);
  });

  test('debug gitignore pattern matching', async () => {
    console.log('\nDebug Pattern Matching:');

    // Test case 1: node_modules pattern
    const nodePath = path.join(workspaceRoot, 'node_modules', 'file.js');
    console.log(`\nTesting node_modules pattern:`);
    console.log(`Path: ${nodePath}`);
    console.log(`Relative to workspace: ${path.relative(workspaceRoot, nodePath)}`);
    const nodeResult = await handler.isIgnored(workspaceRoot, nodePath);
    console.log('Result:', nodeResult);

    // Test case 2: .log pattern
    const logPath = path.join(workspaceRoot, 'src', 'test.log');
    console.log(`\nTesting .log pattern:`);
    console.log(`Path: ${logPath}`);
    console.log(`Relative to workspace: ${path.relative(workspaceRoot, logPath)}`);
    const logResult = await handler.isIgnored(workspaceRoot, logPath);
    console.log('Result:', logResult);

    // Test case 3: Direct file pattern
    const envPath = path.join(workspaceRoot, '.env');
    console.log(`\nTesting .env pattern:`);
    console.log(`Path: ${envPath}`);
    console.log(`Relative to workspace: ${path.relative(workspaceRoot, envPath)}`);
    const envResult = await handler.isIgnored(workspaceRoot, envPath);
    console.log('Result:', envResult);

    // Test case 4: Non-ignored file
    const srcPath = path.join(workspaceRoot, 'src', 'file.ts');
    console.log(`\nTesting non-ignored pattern:`);
    console.log(`Path: ${srcPath}`);
    console.log(`Relative to workspace: ${path.relative(workspaceRoot, srcPath)}`);
    const srcResult = await handler.isIgnored(workspaceRoot, srcPath);
    console.log('Result:', srcResult);
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