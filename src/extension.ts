import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Track which files include other files
const includeMap = new Map<string, Set<string>>();
// Track file watchers to avoid duplicates
const fileWatchers = new Map<string, vscode.FileSystemWatcher>();

export function activate(context: vscode.ExtensionContext) {
	// Original commands
	let disposable = vscode.commands.registerCommand('ai-workflows-helper--vscode-extension.copyFiles', (uri, uris) => {
		copyFilesAsTextStream(uris);
	});
	context.subscriptions.push(disposable);

	let disposable2 = vscode.commands.registerCommand('ai-workflows-helper--vscode-extension.copyFilesAndFolders', (uri, uris) => {
		copyFilesAndFoldersAsTextStream(uris);
	});
	context.subscriptions.push(disposable2);

	// New file inclusion commands
	let disposable3 = vscode.commands.registerCommand('ai-workflows-helper--vscode-extension.scanIncludes', () => {
		scanCurrentFile();
	});
	context.subscriptions.push(disposable3);

	// Watch for file changes
	const watcher = vscode.workspace.createFileSystemWatcher('**/*');
	watcher.onDidChange((uri) => handleFileChange(uri));

	// Watch for active editor changes
	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (editor) {
			scanFile(editor.document);
		}
	});

	context.subscriptions.push(watcher);
}

export function deactivate() {
	// Clean up file watchers
	for (const watcher of fileWatchers.values()) {
		watcher.dispose();
	}
	fileWatchers.clear();
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

// File inclusion functions
async function scanCurrentFile() {
	const editor = vscode.window.activeTextEditor;
	if (editor) {
		await scanFile(editor.document);
	}
}

async function scanFile(document: vscode.TextDocument) {
	const text = document.getText();
	const lines = text.split('\n');
	const includes = new Set<string>();

	// Get include pattern from configuration
	const config = vscode.workspace.getConfiguration('aiWorkflowHelper');
	const includePattern = config.get<string>('includePattern', '@include');
	const pattern = new RegExp(`\\/\\/\\s*${includePattern}\\s+(.*)`);

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(pattern);
		if (match) {
			const includePath = match[1].trim();
			const absolutePath = resolveIncludePath(document.uri, includePath);
			if (absolutePath) {
				includes.add(absolutePath);
				setupFileWatcher(absolutePath);
			}
		}
	}

	includeMap.set(document.uri.fsPath, includes);
	await updateIncludedContent(document);
}

function resolveIncludePath(baseUri: vscode.Uri, includePath: string): string {
	if (path.isAbsolute(includePath)) {
		return includePath;
	}
	const basePath = path.dirname(baseUri.fsPath);
	return path.resolve(basePath, includePath);
}

function setupFileWatcher(filePath: string) {
	if (fileWatchers.has(filePath)) {
		return;
	}

	const watcher = vscode.workspace.createFileSystemWatcher(filePath);
	watcher.onDidChange(() => handleFileChange(vscode.Uri.file(filePath)));
	fileWatchers.set(filePath, watcher);
}

async function handleFileChange(uri: vscode.Uri) {
	for (const [file, includes] of includeMap.entries()) {
		if (includes.has(uri.fsPath)) {
			const document = await vscode.workspace.openTextDocument(file);
			await updateIncludedContent(document);
		}
	}
}

async function updateIncludedContent(document: vscode.TextDocument) {
	const text = document.getText();
	const lines = text.split('\n');
	let newContent = '';

	const config = vscode.workspace.getConfiguration('aiWorkflowHelper');
	const includePattern = config.get<string>('includePattern', '@include');
	const pattern = new RegExp(`\\/\\/\\s*${includePattern}\\s+(.*)`);

	for (let i = 0; i < lines.length; i++) {
		const match = lines[i].match(pattern);
		if (match) {
			const includePath = match[1].trim();
			const absolutePath = resolveIncludePath(document.uri, includePath);
			if (absolutePath && fs.existsSync(absolutePath)) {
				const includedContent = fs.readFileSync(absolutePath, 'utf8');
				newContent += includedContent + '\n';
			} else {
				newContent += `// Error: Could not find file ${includePath}\n`;
			}
		} else {
			newContent += lines[i] + '\n';
		}
	}

	if (newContent !== text) {
		const edit = new vscode.WorkspaceEdit();
		const range = new vscode.Range(
			document.positionAt(0),
			document.positionAt(text.length)
		);
		edit.replace(document.uri, range, newContent.trimEnd());
		await vscode.workspace.applyEdit(edit);
	}
}