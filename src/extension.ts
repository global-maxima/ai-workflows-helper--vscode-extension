// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	let disposable = vscode.commands.registerCommand('ai-workflows-helper--vscode-extension.copyFiles', (uri, uris) => {
	  copyFilesAsTextStream(uris);
	});
  
	context.subscriptions.push(disposable);
  }

// This method is called when your extension is deactivated
export function deactivate() {}

async function copyFilesAsTextStream(uris: vscode.Uri[]) {
	if (!uris || uris.length === 0) {
	  vscode.window.showWarningMessage('No files selected.');
	  return;
	}
  
	let textStream = '';
  
	// Process files in the order they were selected
	for (const uri of uris) {
	  const filePath = uri.fsPath;
	  const fileName = path.basename(filePath);
  
	  try {
		const fileContent = await vscode.workspace.fs.readFile(uri);
		const contentString = Buffer.from(fileContent).toString('utf8');
  
		textStream += `--- ${fileName} ---\n${contentString}\n\n`;
	  } catch (error) {
		vscode.window.showErrorMessage(`Failed to read file: ${fileName}`);
	  }
	}
  
	// Copy to clipboard
	await vscode.env.clipboard.writeText(textStream);
  
	vscode.window.showInformationMessage('Files copied as text stream to clipboard.');
  }
