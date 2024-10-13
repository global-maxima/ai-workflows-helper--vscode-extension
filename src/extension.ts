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

	let disposable2 = vscode.commands.registerCommand('ai-workflows-helper--vscode-extension.copyFilesAndFolders', (uri, uris) => {
		copyFilesAndFoldersAsTextStream(uris);
  });
  context.subscriptions.push(disposable2);
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

/** Copy Files and Files in Folders as Text Stream */
async function copyFilesAndFoldersAsTextStream(uris: vscode.Uri[]) {
	if (!uris || uris.length === 0) {
	  vscode.window.showWarningMessage('No files or folders selected.');
	  return;
	}

	let textStream = '';

	for (const uri of uris) {
		const filePath = uri.fsPath;
		const stats = await vscode.workspace.fs.stat(uri);

		if (stats.type === vscode.FileType.File) {
			const fileName = path.basename(filePath);
			try {
				const fileContent = await vscode.workspace.fs.readFile(uri);
				const contentString = Buffer.from(fileContent).toString('utf8');
				textStream += `--- ${fileName} ---\n${contentString}\n\n`;
			} catch (error) {
				vscode.window.showErrorMessage(`Failed to read file: ${fileName}`);
			}
		} else if (stats.type === vscode.FileType.Directory) {
			const folderName = path.basename(filePath);
			textStream += `--- Folder: ${folderName} ---\n`;
			const folderUris = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, '**/*'));
			for (const folderUri of folderUris) {
				const folderFilePath = folderUri.fsPath;
				const folderFileName = path.relative(filePath, folderFilePath);
				try {
					const fileContent = await vscode.workspace.fs.readFile(folderUri);
					const contentString = Buffer.from(fileContent).toString('utf8');
					textStream += `--- ${folderFileName} ---\n${contentString}\n\n`;
				} catch (error) {
					vscode.window.showErrorMessage(`Failed to read file: ${folderFileName}`);
				}
			}
		}
	}

	await vscode.env.clipboard.writeText(textStream);
	vscode.window.showInformationMessage('Files and folders copied as text stream to clipboard.');
}

async function copyFilesWithDepthAsTextStream(uris: vscode.Uri[], depth: number) {
  if (!uris || uris.length === 0) {
    vscode.window.showWarningMessage('No files selected.');
    return;
  }

  let textStream = '';

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

  await vscode.env.clipboard.writeText(textStream);
  vscode.window.showInformationMessage('Files copied as text stream to clipboard.');
}