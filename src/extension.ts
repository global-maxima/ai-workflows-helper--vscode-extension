import * as vscode from 'vscode';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
	// Helper function to handle URI parameters consistently
	function getUrisToProcess(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined): vscode.Uri[] {
		if (uris && uris.length > 0) {
			return uris;
		}
		return uri ? [uri] : [];
	}

	const commands = [
		{
			id: 'ai-workflows-helper.copyFiles',
			handler: copyFilesAsTextStream
		},
		{
			id: 'ai-workflows-helper.copyFilesAndFolders',
			handler: copyFilesAndFoldersAsTextStream
		},
		{
			id: 'ai-workflows-helper.copyFilesWithDiagnostics',
			handler: copyFilesWithDiagnostics
		},
		{
			id: 'ai-workflows-helper.copyFilesInFoldersWithDiagnostics',
			handler: copyFilesInFoldersWithDiagnostics
		}
	];

	commands.forEach(({ id, handler }) => {
		const disposable = vscode.commands.registerCommand(
			id,
			(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
				const filesToProcess = getUrisToProcess(uri, uris);
				if (filesToProcess.length === 0) {
					vscode.window.showWarningMessage('No files or folders selected.');
					return;
				}
				handler(filesToProcess);
			}
		);
		context.subscriptions.push(disposable);
	});
}

// Unified file reading function to reduce code duplication
async function readFileToStream(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
	const filePath = uri.fsPath;
	const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

	try {
		const fileContent = await vscode.workspace.fs.readFile(uri);
		const contentString = Buffer.from(fileContent).toString('utf8');
		return `--- ${relativePath} ---\n${contentString}\n\n`;
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to read file: ${relativePath}`);
		return '';
	}
}

async function readFileWithDiagnostics(uri: vscode.Uri, workspaceFolder: vscode.WorkspaceFolder): Promise<string> {
	const filePath = uri.fsPath;
	const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
	let output = '';

	try {
		// Get file content
		const fileContent = await vscode.workspace.fs.readFile(uri);
		output = `--- ${relativePath} ---\n${fileContent.toString()}\n`;

		// Get current diagnostics
		const diagnostics = vscode.languages.getDiagnostics(uri);
		if (diagnostics.length > 0) {
			output += '\n--- Diagnostics ---\n';
			for (const d of diagnostics) {
				output += `${d.source} ${d.code}: ${d.message} (${d.severity})\n`;
				output += `  at lines ${d.range.start.line + 1}:${d.range.start.character + 1}-${d.range.end.line + 1}:${d.range.end.character + 1}\n`;
			}
		}

		return output + '\n';
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to read file: ${relativePath}`);
		return '';
	}
}

async function copyFilesAsTextStream(uris: vscode.Uri[]) {
	if (!uris || uris.length === 0) {
		vscode.window.showWarningMessage('No files selected.');
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder found.');
		return;
	}

	let textStream = '';
	for (const uri of uris) {
		textStream += await readFileToStream(uri, workspaceFolder);
	}

	await vscode.env.clipboard.writeText(textStream);
	vscode.window.showInformationMessage('Files copied as text stream to clipboard.');
}

async function copyFilesWithDiagnostics(uris: vscode.Uri[]) {
	if (!uris || uris.length === 0) {
		vscode.window.showWarningMessage('No files selected.');
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder found.');
		return;
	}

	let textStream = '';
	for (const uri of uris) {
		textStream += await readFileWithDiagnostics(uri, workspaceFolder);
	}

	await vscode.env.clipboard.writeText(textStream);
	vscode.window.showInformationMessage('Files copied with problems to clipboard.');
}

async function copyFilesAndFoldersAsTextStream(uris: vscode.Uri[]) {
	if (!uris || uris.length === 0) {
		vscode.window.showWarningMessage('No files or folders selected.');
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder found.');
		return;
	}

	let textStream = '';

	for (const uri of uris) {
		const stats = await vscode.workspace.fs.stat(uri);

		if (stats.type === vscode.FileType.File) {
			textStream += await readFileToStream(uri, workspaceFolder);
		} else if (stats.type === vscode.FileType.Directory) {
			const folderName = path.basename(uri.fsPath);
			textStream += `--- Folder: ${folderName} ---\n`;
			const folderUris = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, '**/*'));
			for (const folderUri of folderUris) {
				textStream += await readFileToStream(folderUri, workspaceFolder);
			}
		}
	}



	await vscode.env.clipboard.writeText(textStream);
	vscode.window.showInformationMessage('Files and folders copied as text stream to clipboard.');
}

async function copyFilesInFoldersWithDiagnostics(uris: vscode.Uri[]) {
	if (!uris || uris.length === 0) {
		vscode.window.showWarningMessage('No files or folders selected.');
		return;
	}

	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder found.');
		return;
	}

	let textStream = '';

	for (const uri of uris) {
		const stats = await vscode.workspace.fs.stat(uri);

		if (stats.type === vscode.FileType.File) {
			textStream += await readFileWithDiagnostics(uri, workspaceFolder);
		} else if (stats.type === vscode.FileType.Directory) {
			const folderName = path.basename(uri.fsPath);
			textStream += `--- Folder: ${folderName} ---\n`;
			const folderUris = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, '**/*'));
			for (const folderUri of folderUris) {
				textStream += await readFileWithDiagnostics(folderUri, workspaceFolder);
			}
		}
	}

	await vscode.env.clipboard.writeText(textStream);
	vscode.window.showInformationMessage('Files and folders copied with problems to clipboard.');
}