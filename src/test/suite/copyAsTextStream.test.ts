import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { debugLog } from './utils';

suite('CopyAsTextStream Test Suite', () => {
  let testFileUri: vscode.Uri;

  suiteSetup(async () => {
    debugLog('Test Setup', 'Starting test setup');

    // Create test workspace
    const workspaceFolder = vscode.workspace.workspaceFolders![0].uri.fsPath;
    debugLog('Workspace Root', workspaceFolder);

    // Create test file
    const testFilePath = path.join(workspaceFolder, 'test.ts');
    debugLog('Test File Path', testFilePath);

    fs.writeFileSync(testFilePath, `console.log('Hello from test file')`, 'utf8');
    testFileUri = vscode.Uri.file(testFilePath);

    // Open test file
    const doc = await vscode.workspace.openTextDocument(testFileUri);
    await vscode.window.showTextDocument(doc);

    debugLog('Document Content', doc.getText());

    // Ensure extension is activated
    const extension = vscode.extensions.getExtension('GlobalMaxima.ai-workflows-helper');
    debugLog('Extension', extension ? 'Found' : 'Not Found');
    if (extension && !extension.isActive) {
      debugLog('Extension Status', 'Activating extension');
      await extension.activate();
      debugLog('Extension Status', 'Extension activated');
    }
  });

  test('Should copy contents to clipboard when "Copy as Text Stream" is executed', async () => {
    // Disable gitignore processing at all levels
    const config = vscode.workspace.getConfiguration('ai-workflows-helper');
    const originalSettings = {
      gitignoreEnabled: await config.get('gitignore.enabled'),
      respectGlobalIgnore: await config.get('gitignore.respectGlobalIgnore'),
      respectNestedIgnores: await config.get('gitignore.respectNestedIgnores')
    };

    debugLog('Original Settings', originalSettings);

    try {
      debugLog('Test Start', 'Beginning clipboard test');
      // Update all gitignore-related settings
      await Promise.all([
        config.update('gitignore.enabled', false, vscode.ConfigurationTarget.Workspace),
        config.update('gitignore.respectGlobalIgnore', false, vscode.ConfigurationTarget.Workspace),
        config.update('gitignore.respectNestedIgnores', false, vscode.ConfigurationTarget.Workspace)
      ]);

      debugLog('Settings Updated', 'Reloading window to apply changes');

      // Force reload of configuration
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
      debugLog('Window Reloaded', 'Waiting for extension to reactivate');

      // Wait for window to reload and extension to reactivate
      await new Promise(resolve => setTimeout(resolve, 2000));

      debugLog('Extension Reactivated', 'Verifying updated settings');
      // Verify settings were updated
      const updatedConfig = vscode.workspace.getConfiguration('ai-workflows-helper');
      const verifySettings = {
        gitignoreEnabled: await updatedConfig.get('gitignore.enabled'),
        respectGlobalIgnore: await updatedConfig.get('gitignore.respectGlobalIgnore'),
        respectNestedIgnores: await updatedConfig.get('gitignore.respectNestedIgnores')
      };
      debugLog('Updated Settings', verifySettings);

      assert.strictEqual(verifySettings.gitignoreEnabled, false, 'gitignore.enabled should be false');
      assert.strictEqual(verifySettings.respectGlobalIgnore, false, 'gitignore.respectGlobalIgnore should be false');
      assert.strictEqual(verifySettings.respectNestedIgnores, false, 'gitignore.respectNestedIgnores should be false');

      debugLog('Test Start', 'Beginning clipboard test');

      // Clear clipboard and verify
      await vscode.env.clipboard.writeText('');
      const initialClipboard = await vscode.env.clipboard.readText();
      debugLog('Initial Clipboard', initialClipboard);
      assert.strictEqual(initialClipboard, '', 'Clipboard should be empty initially');

      // Execute command with URI
      debugLog('Executing Command', 'ai-workflows-helper.copyAsTextStream');
      const result = await vscode.commands.executeCommand(
        'ai-workflows-helper.copyAsTextStream',
        testFileUri
      );
      debugLog('Command Result', result);

      // Wait for clipboard operation to complete
      await new Promise(resolve => setTimeout(resolve, 500));

      // Final clipboard check
      const clipboardContent = await vscode.env.clipboard.readText();
      debugLog('Final Clipboard Content', clipboardContent);

      assert.ok(
        clipboardContent.includes(`console.log('Hello from test file')`),
        `Expected clipboard to contain test content but got: ${clipboardContent}`
      );
    } finally {
      // Restore original settings
      await Promise.all([
        config.update('gitignore.enabled', originalSettings.gitignoreEnabled, vscode.ConfigurationTarget.Workspace),
        config.update('gitignore.respectGlobalIgnore', originalSettings.respectGlobalIgnore, vscode.ConfigurationTarget.Workspace),
        config.update('gitignore.respectNestedIgnores', originalSettings.respectNestedIgnores, vscode.ConfigurationTarget.Workspace)
      ]);
      debugLog('Settings Restored', originalSettings);
    }
  });

  test('Should copy contents and diagnostics to clipboard when "Copy as Text Stream with Diagnostics" is executed', async () => {
    // Disable gitignore processing
    const config = vscode.workspace.getConfiguration('ai-workflows-helper');
    const originalSettings = {
      gitignoreEnabled: await config.get('gitignore.enabled'),
      respectGlobalIgnore: await config.get('gitignore.respectGlobalIgnore'),
      respectNestedIgnores: await config.get('gitignore.respectNestedIgnores')
    };

    debugLog('Original Settings', originalSettings);

    try {
      // Update all gitignore-related settings
      await Promise.all([
        config.update('gitignore.enabled', false, vscode.ConfigurationTarget.Workspace),
        config.update('gitignore.respectGlobalIgnore', false, vscode.ConfigurationTarget.Workspace),
        config.update('gitignore.respectNestedIgnores', false, vscode.ConfigurationTarget.Workspace)
      ]);

      // Force reload of configuration
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for reload

      // Verify updated settings
      const updatedConfig = vscode.workspace.getConfiguration('ai-workflows-helper');
      const verifySettings = {
        gitignoreEnabled: await updatedConfig.get('gitignore.enabled'),
        respectGlobalIgnore: await updatedConfig.get('gitignore.respectGlobalIgnore'),
        respectNestedIgnores: await updatedConfig.get('gitignore.respectNestedIgnores')
      };
      debugLog('Updated Settings', verifySettings);

      // Clear clipboard
      await vscode.env.clipboard.writeText('');
      const initialClipboard = await vscode.env.clipboard.readText();
      assert.strictEqual(initialClipboard, '', 'Clipboard should be empty initially');

      // Execute the "with diagnostics" command
      debugLog('Executing Command', 'ai-workflows-helper.copyAsTextStreamWithDiagnostics');
      const result = await vscode.commands.executeCommand(
        'ai-workflows-helper.copyAsTextStreamWithDiagnostics',
        testFileUri
      );
      debugLog('Command Result', result);

      // Wait briefly for the clipboard operation
      await new Promise(resolve => setTimeout(resolve, 500));

      // Check clipboard content
      const clipboardContent = await vscode.env.clipboard.readText();
      debugLog('Final Clipboard Content', clipboardContent);

      // Ensure the test file content is present
      assert.ok(
        clipboardContent.includes(`console.log('Hello from test file')`),
        `Expected clipboard to contain test file contents`
      );

      // Ensure some form of diagnostic info is present 
      // (you can adjust this to match your actual diagnostic output)
      assert.ok(
        clipboardContent.includes('Diagnostics:'),
        `Expected clipboard to contain diagnostic info`
      );
    } finally {
      // Restore original settings
      await Promise.all([
        config.update('gitignore.enabled', originalSettings.gitignoreEnabled, vscode.ConfigurationTarget.Workspace),
        config.update('gitignore.respectGlobalIgnore', originalSettings.respectGlobalIgnore, vscode.ConfigurationTarget.Workspace),
        config.update('gitignore.respectNestedIgnores', originalSettings.respectNestedIgnores, vscode.ConfigurationTarget.Workspace)
      ]);
      debugLog('Settings Restored', originalSettings);
    }
  });


  suiteTeardown(() => {
    if (fs.existsSync(testFileUri.fsPath)) {
      fs.unlinkSync(testFileUri.fsPath);
    }
  });
});