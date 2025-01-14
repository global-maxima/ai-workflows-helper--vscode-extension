/*
 * File Context:
 * Example test file explicitly activating the extension before command execution
 */

import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// Import your extension's activate function.
// Make sure the import path points to your actual extension entry.
import { activate } from '../../extension';

suite('CopyAsTextStream Test Suite', function () {
  let tempWorkspacePath: string;
  let testFileUri: vscode.Uri;

  suiteSetup(async () => {
    // Create a temporary workspace
    tempWorkspacePath = path.join(os.tmpdir(), `test-workspace-${Math.random().toString(36).substring(7)}`);
    fs.mkdirSync(tempWorkspacePath, { recursive: true });

    // Create a test file
    const testFilePath = path.join(tempWorkspacePath, 'dummy.ts');
    fs.writeFileSync(testFilePath, `console.log('Hello from test file')`, 'utf8');
    testFileUri = vscode.Uri.file(testFilePath);

    // Open the test file in the editor
    const doc = await vscode.workspace.openTextDocument(testFileUri);
    await vscode.window.showTextDocument(doc);

    // Explicitly activate the extension
    // Depending on your setup, you may need to pass a mock or real ExtensionContext here.
    await activate(vscode.extensions.getExtension('GlobalMaxima.ai-workflows-helper')?.exports);
  });

  suiteTeardown(() => {
    // Clean up
    if (fs.existsSync(tempWorkspacePath)) {
      fs.rmSync(tempWorkspacePath, { recursive: true, force: true });
    }
  });

  test('Should copy contents to clipboard when "Copy as Text Stream" is executed', async () => {
    // Clear clipboard first
    await vscode.env.clipboard.writeText('');

    // Execute the command
    await vscode.commands.executeCommand('ai-workflows-helper.copyAsTextStream');

    // Read clipboard
    const clipboardContent = await vscode.env.clipboard.readText();

    // Verify test file content is present in the copied text
    assert.ok(
      clipboardContent.includes(`console.log('Hello from test file')`),
      'Expected test file contents to be in the clipboard'
    );
  });
});
