'use strict'

import { Uri, workspace, Event, EventEmitter, Disposable } from 'vscode';

import { ScmViewProvider } from './scmViewProvider';
import { ExplorerViewProvider } from './explorerViewProvider';
import { git } from './git';

export interface Configuration {
    readonly useExplorer?: boolean;
    readonly commitsCount?: number;
    readonly expressMode?: boolean;
    withFolder?: boolean;
}

export interface FilesViewContext {
    repo: git.GitRepo;
    leftRef?: string;
    rightRef?: string;
    specifiedPath?: Uri;
    focusedLineInfo?: string;
}

export interface HistoryViewContext {
    repo: git.GitRepo;
    branch?: string;
    specifiedPath?: Uri;
    line?: number;
    author?: string;
}

function getConfiguration(): Configuration {
    return {
        useExplorer: <boolean>workspace.getConfiguration('githd.committedFiles').get('inExplorerView'),
        withFolder: <boolean>workspace.getConfiguration('githd.explorerView').get('withFolder'),
        commitsCount: <number>workspace.getConfiguration('githd.logView').get('commitsCount'),
        expressMode: <boolean>workspace.getConfiguration('githd.logView').get('expressMode')
    };
}


function sameUri(lhs: Uri, rhs: Uri): boolean {
    if (!lhs && !rhs) {
        return true;
    }
    if ((lhs && !rhs) || (!lhs && rhs)) {
        return false;
    }
    return lhs.fsPath === rhs.fsPath;
}

export class Model {
    private _scmProvider: ScmViewProvider;
    private _explorerProvider: ExplorerViewProvider;
    private _config: Configuration;

    private _historyViewContext: HistoryViewContext;
    private _filesViewContext: FilesViewContext;

    private _onDidChangeConfiguratoin = new EventEmitter<Configuration>();
    private _onDidChangeFilesViewContext = new EventEmitter<FilesViewContext>();
    private _onDidChangeHistoryViewContext = new EventEmitter<HistoryViewContext>();

    private _disposables: Disposable[] = [];

    constructor() {
        this._config = getConfiguration();
        this._explorerProvider = new ExplorerViewProvider(this);
        this._disposables.push(this._explorerProvider);
        if (!this._config.useExplorer) {
            this._scmProvider = new ScmViewProvider(this);
            this._disposables.push(this._scmProvider);
        }
        workspace.onDidChangeConfiguration(() => {
            let newConfig = getConfiguration();
            if (newConfig.useExplorer !== this._config.useExplorer ||
                newConfig.withFolder !== this._config.withFolder ||
                newConfig.commitsCount !== this._config.commitsCount ||
                newConfig.expressMode !== this._config.expressMode) {

                if (newConfig.useExplorer !== this._config.useExplorer) {
                    // Cannot dispose TreeDataProvider because of it's bug: onDidChangeTreeData doesn't work after re-creation!
                    if (newConfig.useExplorer) {
                        this._scmProvider.dispose();
                    } else {
                        this._scmProvider = new ScmViewProvider(this);
                        this._disposables.push(this._scmProvider);
                    }
                }
                this._config = newConfig;
                this._onDidChangeConfiguratoin.fire(newConfig);
            }
        }, null, this._disposables);

        workspace.onDidChangeWorkspaceFolders(e => {
            git.updateGitRoots(workspace.workspaceFolders);
        }, null, this._disposables);
        git.updateGitRoots(workspace.workspaceFolders);

        this._disposables.push(this._onDidChangeConfiguratoin);
        this._disposables.push(this._onDidChangeFilesViewContext);
        this._disposables.push(this._onDidChangeHistoryViewContext);
    }

    get configuration(): Configuration { return this._config; }

    get filesViewContext(): FilesViewContext {
        return this._filesViewContext;
    }
    set filesViewContext(context: FilesViewContext) {
        if (!this._filesViewContext) {
            this._filesViewContext = context;
            this._onDidChangeFilesViewContext.fire(this._filesViewContext);
            return;
        }
        if (this._filesViewContext.leftRef != context.leftRef
            || this._filesViewContext.rightRef != context.rightRef
            || this._filesViewContext.specifiedPath != context.specifiedPath
            || this._filesViewContext.focusedLineInfo != context.focusedLineInfo) {

            this._filesViewContext = context;
            this._onDidChangeFilesViewContext.fire(this._filesViewContext);
        }
    }

    get historyViewContext(): HistoryViewContext {
        return this._historyViewContext;
    }
    async setHistoryViewContext(context: HistoryViewContext) {
        this._historyViewContext = context;
        if (!this._historyViewContext.branch) {
            this._historyViewContext.branch = await git.getCurrentBranch(context.repo);
        }
        this._onDidChangeHistoryViewContext.fire(this._historyViewContext);
    }

    get onDidChangeConfiguration(): Event<Configuration> { return this._onDidChangeConfiguratoin.event; }
    get onDidChangeFilesViewContext(): Event<FilesViewContext> { return this._onDidChangeFilesViewContext.event; }
    get onDidChangeHistoryViewContext(): Event<HistoryViewContext> { return this._onDidChangeHistoryViewContext.event; }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }
}
