// src/extension.ts
import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigurationManager } from './extension/config';
import { DependencyCollector } from './extension/withDependencies';
import { getUrisToProcess } from './extension/utils';

const configManager = new ConfigurationManager();
const dependencyCollector = new DependencyCollector();

// added at 2024-12-19: Restore original file streaming functionality
async function processSelection(uris: vscode.Uri[], includeDiagnostics: boolean) {
	const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
	if (!workspaceFolder) {
		vscode.window.showErrorMessage('No workspace folder found.');
		return;
	}

	await vscode.window.withProgress({
		location: vscode.ProgressLocation.Notification,
		title: "AI Workflow Helper",
		cancellable: false
	}, async (progress) => {
		progress.report({ message: "Copying content..." });

		let textStream = '';
		for (const uri of uris) {
			const stats = await vscode.workspace.fs.stat(uri);

			if (stats.type === vscode.FileType.File) {
				textStream += await (includeDiagnostics ?
					readFileWithDiagnostics(uri, workspaceFolder) :
					readFileToStream(uri, workspaceFolder));
			} else if (stats.type === vscode.FileType.Directory) {
				const folderName = path.basename(uri.fsPath);
				textStream += `--- Folder: ${folderName} ---\n`;
				const folderUris = await vscode.workspace.findFiles(new vscode.RelativePattern(uri, '**/*'));
				for (const folderUri of folderUris) {
					textStream += await (includeDiagnostics ?
						readFileWithDiagnostics(folderUri, workspaceFolder) :
						readFileToStream(folderUri, workspaceFolder));
				}
			}
		}

		await vscode.env.clipboard.writeText(textStream);
		progress.report({
			increment: 100,
			message: `Content copied${includeDiagnostics ? ' with diagnostics' : ''}`
		});

		await new Promise(resolve => setTimeout(resolve, 3000));
	});
}

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
		const fileContent = await vscode.workspace.fs.readFile(uri);
		output = `--- ${relativePath} ---\n${fileContent.toString()}\n`;

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

// added at 2024-12-19: Command registration for all functionality
export function activate(context: vscode.ExtensionContext) {
	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const config = configManager.getConfig(folder);
		}
	}

	// Register original commands
	const baseCommands = [
		{
			id: 'ai-workflows-helper.copyAsTextStream',
			handler: async (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
				const filesToProcess = getUrisToProcess(uri, uris);
				if (filesToProcess.length === 0) {
					vscode.window.showWarningMessage('No files or folders selected.');
					return;
				}
				await processSelection(filesToProcess, false);
			}
		},
		{
			id: 'ai-workflows-helper.copyAsTextStreamWithDiagnostics',
			handler: async (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
				const filesToProcess = getUrisToProcess(uri, uris);
				if (filesToProcess.length === 0) {
					vscode.window.showWarningMessage('No files or folders selected.');
					return;
				}
				await processSelection(filesToProcess, true);
			}
		}
	];

	baseCommands.forEach(({ id, handler }) => {
		const disposable = vscode.commands.registerCommand(id, handler);
		context.subscriptions.push(disposable);
	});

	// Register dependency command
	const copyWithLocalDeps = vscode.commands.registerCommand(
		'ai-workflows-helper.copyWithLocalDependencies',
		async (uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined) => {
			const filesToProcess = getUrisToProcess(uri, uris);
			if (filesToProcess.length === 0) {
				vscode.window.showWarningMessage('No files selected.');
				return;
			}

			await vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: "AI Workflow Helper",
				cancellable: true
			}, async (progress, token) => {
				const context = {
					focusFiles: new Set(filesToProcess.map(u => u.fsPath)),
					outputted: new Set<string>(),
					progress,
					token
				};

				let textStream = '';
				let totalProcessedCount = 0;
				let totalErrorCount = 0;

				for (const uri of filesToProcess) {
					if (token.isCancellationRequested) {
						break;
					}

					try {
						const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
						if (!workspaceFolder) {
							throw new Error('No workspace folder found for the given file');
						}
						const config = configManager.getConfig(workspaceFolder);

						const { textStream: newContent, processedCount, errorCount } =
							await dependencyCollector.collectAndStreamDependencies(uri, config, context);

						textStream += newContent;
						totalProcessedCount += processedCount;
						totalErrorCount += errorCount;
					} catch (error) {
						vscode.window.showErrorMessage(`Error processing ${uri.fsPath}: ${error}`);
						totalErrorCount++;
					}
				}

				if (totalErrorCount > 0) {
					vscode.window.showWarningMessage(
						`Completed with ${totalErrorCount} errors. Some dependencies may be missing.`
					);
				}

				await vscode.env.clipboard.writeText(textStream);
				progress.report({
					increment: 100,
					message: `Content copied (${totalProcessedCount} files)`
				});

				await new Promise(resolve => setTimeout(resolve, 3000));
			});
		}
	);

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(async event => {
			configManager.handleWorkspaceFoldersChanged(event);
		})
	);

	context.subscriptions.push(copyWithLocalDeps);
}

export function deactivate() { }