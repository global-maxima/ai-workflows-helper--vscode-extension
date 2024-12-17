import * as vscode from 'vscode';
import * as path from 'path';

// 2024-12-17: Core interfaces define the shape of our domain
interface ProjectConfig {
	rootPath: string;
	maxDepth?: number;
	excludePatterns: string[];
}

interface DependencyResult {
	uri: vscode.Uri;
	error?: string;
	referencedBy?: string[];
	defines?: string[];
	references?: string[];
}

// 2024-12-17: Uncomfortable with this global state pattern, but VS Code extension model somewhat forces our hand
const workspaceConfigs: Map<string, ProjectConfig> = new Map();

interface DependencyCollectionState {
	dependencies: Map<string, DependencyResult>;
	visited: Set<string>;
	depth: number;
}

function getProjectConfig(workspaceFolder: vscode.WorkspaceFolder): ProjectConfig {
	// 2024-12-17: Discomfort - mixing configuration sources without clear precedence rules
	return {
		rootPath: workspaceFolder.uri.fsPath,
		maxDepth: vscode.workspace.getConfiguration('aiWorkflowsHelper', workspaceFolder.uri)
			.get<number>('maxDepth', 3),
		excludePatterns: vscode.workspace.getConfiguration('aiWorkflowsHelper', workspaceFolder.uri)
			.get<string[]>('excludePatterns', [])
	};
}

function isValidDependencyPath(config: ProjectConfig, filePath: string): boolean {
	// 2024-12-17: Uncomfortable with how simple this is - might miss important boundary cases
	return filePath.startsWith(config.rootPath);
}

function getUrisToProcess(uri: vscode.Uri | undefined, uris: vscode.Uri[] | undefined): vscode.Uri[] {
	if (uris && uris.length > 0) {
		return uris;
	}
	return uri ? [uri] : [];
}

function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
	return vscode.workspace.getWorkspaceFolder(uri);
}

async function readFileToStream(
	uri: vscode.Uri,
	workspaceFolder: vscode.WorkspaceFolder,
	context: {
		isFocusFile?: boolean,
		referencedBy?: string[],
		defines?: string[],
		references?: string[]
	} = {}
): Promise<string> {
	const filePath = uri.fsPath;
	const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);

	try {
		const fileContent = await vscode.workspace.fs.readFile(uri);
		const contentString = Buffer.from(fileContent).toString('utf8');

		// 2024-12-17: Uncomfortable with the rigid structure of this comment block
		let contextBlock = '/*\n';
		contextBlock += ' * File Context:\n';
		if (context.isFocusFile) {
			contextBlock += ' * - Focus File (explicitly selected by user)\n';
		}
		if (context.referencedBy?.length) {
			contextBlock += ' * - Referenced by:\n';
			contextBlock += context.referencedBy.map(ref => ` *   - ${ref}`).join('\n') + '\n';
		}
		if (context.defines?.length) {
			contextBlock += ' * - Defines symbols:\n';
			contextBlock += context.defines.map(def => ` *   - ${def}`).join('\n') + '\n';
		}
		if (context.references?.length) {
			contextBlock += ' * - References symbols:\n';
			contextBlock += context.references.map(ref => ` *   - ${ref}`).join('\n') + '\n';
		}
		contextBlock += ' */\n\n';

		return `--- ${relativePath} ---\n${contextBlock}${contentString}\n\n`;
	} catch (error) {
		vscode.window.showErrorMessage(`Failed to read file: ${relativePath}`);
		return '';
	}
}

async function collectDependenciesWithState(
	uri: vscode.Uri,
	config: ProjectConfig,
	state: DependencyCollectionState
): Promise<void> {
	// 2024-12-17: Uncomfortable with how depth tracking interacts with multiple entry points
	if (state.depth >= (config.maxDepth || 3) || state.visited.has(uri.fsPath)) {
		return;
	}

	state.visited.add(uri.fsPath);
	state.depth++;

	try {
		const document = await vscode.workspace.openTextDocument(uri);

		// 2024-12-17: Discomfort - we're querying for all symbols at position 0,0
		// This might miss contextual symbols that only make sense at specific locations
		const symbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
			'vscode.executeDocumentSymbolProvider',
			document.uri
		);

		const definedSymbols = symbols?.map(s => s.name) || [];

		const [definitions, references] = await Promise.all([
			vscode.commands.executeCommand<vscode.Location[]>(
				'vscode.executeDefinitionProvider',
				document.uri,
				new vscode.Position(0, 0)
			),
			vscode.commands.executeCommand<vscode.Location[]>(
				'vscode.executeReferenceProvider',
				document.uri,
				new vscode.Position(0, 0)
			)
		]);

		// 2024-12-17: Uncomfortable with potential for duplicate processing from different entry points
		const locations = new Map<string, { location: vscode.Location; type: 'definition' | 'reference' }>();
		definitions?.forEach(loc => locations.set(loc.uri.fsPath, { location: loc, type: 'definition' }));
		references?.forEach(loc => locations.set(loc.uri.fsPath, { location: loc, type: 'reference' }));

		for (const [defPath, info] of locations) {
			const def = info.location.uri;

			if (!isValidDependencyPath(config, def.fsPath) ||
				config.excludePatterns.some(pattern =>
					def.fsPath.includes(pattern.replace('**', '')))) {
				continue;
			}

			const relativePath = path.relative(config.rootPath, uri.fsPath);
			let existingDep = state.dependencies.get(def.fsPath);

			if (!existingDep) {
				existingDep = {
					uri: def,
					referencedBy: [],
					defines: [],
					references: []
				};
				state.dependencies.set(def.fsPath, existingDep);
			}

			if (info.type === 'reference' && !existingDep.referencedBy?.includes(relativePath)) {
				existingDep.referencedBy = [...(existingDep.referencedBy || []), relativePath];
			}

			if (definedSymbols.length > 0) {
				existingDep.defines = [...new Set([...(existingDep.defines || []), ...definedSymbols])];
			}

			// 2024-12-17: Recursive call increases cognitive complexity
			await collectDependenciesWithState(def, config, state);
		}
	} catch (error) {
		console.error('Error collecting dependencies:', error);
		state.dependencies.set(uri.fsPath, {
			uri,
			error: error instanceof Error ? error.message : 'Unknown error'
		});
	}

	state.depth--;
}

async function collectAndStreamDependencies(
	uri: vscode.Uri,
	config: ProjectConfig,
	context: {
		focusFiles: Set<string>,
		outputted: Set<string>,
		progress: vscode.Progress<{ message?: string; increment?: number }>,
		token: vscode.CancellationToken
	}
): Promise<{
	textStream: string,
	processedCount: number,
	errorCount: number
}> {
	let textStream = '';
	let processedCount = 0;
	let errorCount = 0;

	try {
		const state: DependencyCollectionState = {
			dependencies: new Map(),
			visited: new Set(),
			depth: 0
		};

		await collectDependenciesWithState(uri, config, state);

		textStream += '/*\n';
		textStream += ' * Dependency Collection Diagnostics:\n';
		textStream += ` * Focus file: ${uri.fsPath}\n`;
		textStream += ` * Total dependencies found: ${state.dependencies.size}\n`;
		textStream += ' * Dependencies:\n';
		for (const [depPath, dep] of state.dependencies.entries()) {
			textStream += ` *   - ${depPath}\n`;
			textStream += ` *     Referenced by: ${dep.referencedBy?.join(', ') || 'none'}\n`;
		}
		textStream += ' * Already outputted files:\n';
		for (const outputted of context.outputted) {
			textStream += ` *   - ${outputted}\n`;
		}
		textStream += ' */\n\n';

		const workspaceFolder = getWorkspaceFolder(uri);
		if (workspaceFolder && !context.outputted.has(uri.fsPath)) {
			textStream += await readFileToStream(uri, workspaceFolder, {
				isFocusFile: true
			});
			context.outputted.add(uri.fsPath);
			processedCount++;
		}

		// 2024-12-17: Uncomfortable with sorting by path - might not reflect semantic relationships
		const sortedDeps = Array.from(state.dependencies.entries())
			.sort(([a], [b]) => a.localeCompare(b));

		for (const [depPath, dep] of sortedDeps) {
			if (context.token.isCancellationRequested) {
				break;
			}

			if (context.outputted.has(depPath)) {
				continue;
			}

			if (dep.error) {
				errorCount++;
				textStream += `--- Error processing ${depPath} ---\n${dep.error}\n\n`;
				context.outputted.add(depPath);
				continue;
			}

			const depWorkspaceFolder = getWorkspaceFolder(dep.uri);
			if (!depWorkspaceFolder) {
				continue;
			}

			textStream += await readFileToStream(
				dep.uri,
				depWorkspaceFolder,
				{
					isFocusFile: context.focusFiles.has(depPath),
					referencedBy: dep.referencedBy,
					defines: dep.defines,
					references: dep.references
				}
			);
			context.outputted.add(depPath);
			processedCount++;

			context.progress.report({
				message: `Processing dependencies... (${processedCount} files)`,
				increment: 100 / (state.dependencies.size + 1)
			});
		}
	} catch (error) {
		console.error('Error in collectAndStreamDependencies:', error);
		errorCount++;
	}

	return { textStream, processedCount, errorCount };
}

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
					const workspaceFolder = getWorkspaceFolder(uri);
					if (!workspaceFolder) {
						throw new Error('No workspace folder found for the given file');
					}
					const config = workspaceConfigs.get(workspaceFolder.uri.fsPath);

					if (!config) {
						throw new Error('No configuration found for workspace');
					}

					const { textStream: newContent, processedCount, errorCount } =
						await collectAndStreamDependencies(uri, config, context);

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

export function activate(context: vscode.ExtensionContext) {
	if (vscode.workspace.workspaceFolders) {
		for (const folder of vscode.workspace.workspaceFolders) {
			const config = getProjectConfig(folder);
			workspaceConfigs.set(folder.uri.fsPath, config);
		}
	}

	context.subscriptions.push(
		vscode.workspace.onDidChangeWorkspaceFolders(async event => {
			for (const folder of event.removed) {
				workspaceConfigs.delete(folder.uri.fsPath);
			}
			for (const folder of event.added) {
				const config = getProjectConfig(folder);
				workspaceConfigs.set(folder.uri.fsPath, config);
			}
		})
	);

	context.subscriptions.push(copyWithLocalDeps);
}

export function deactivate() { }