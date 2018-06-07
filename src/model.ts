'use strict'

import { Uri, workspace, Event, EventEmitter, Disposable } from 'vscode';

import { ExplorerViewProvider } from './explorerViewProvider';
import { GitService, GitRepo } from './gitService';

export interface Configuration {
    readonly commitsCount?: number;
    readonly expressMode?: boolean;
    readonly displayExpress?: boolean;
    withFolder?: boolean;
}

export interface FilesViewContext {
    repo: GitRepo;
    leftRef?: string;
    rightRef?: string;
    specifiedPath?: Uri;
    focusedLineInfo?: string;
}

export interface HistoryViewContext {
    repo: GitRepo;
    branch?: string;
    specifiedPath?: Uri;
    line?: number;
    author?: string;
}

function getConfiguration(): Configuration {
    return {
        withFolder: <boolean>workspace.getConfiguration('githd.explorerView').get('withFolder'),
        commitsCount: <number>workspace.getConfiguration('githd.logView').get('commitsCount'),
        expressMode: <boolean>workspace.getConfiguration('githd.logView').get('expressMode'),
        displayExpress: <boolean>workspace.getConfiguration('githd.logView').get('displayExpressStatus')
    };
}

export class Model {
    private _explorerProvider: ExplorerViewProvider;
    private _config: Configuration;

    private _historyViewContext: HistoryViewContext;
    private _filesViewContext: FilesViewContext;

    private _onDidChangeConfiguratoin = new EventEmitter<Configuration>();
    private _onDidChangeFilesViewContext = new EventEmitter<FilesViewContext>();
    private _onDidChangeHistoryViewContext = new EventEmitter<HistoryViewContext>();

    private _disposables: Disposable[] = [];

    constructor(private _gitService: GitService) {
        this._config = getConfiguration();
        this._explorerProvider = new ExplorerViewProvider(this, this._gitService);
        this._disposables.push(this._explorerProvider);

        workspace.onDidChangeConfiguration(() => {
            let newConfig = getConfiguration();
            if (newConfig.withFolder !== this._config.withFolder ||
                newConfig.commitsCount !== this._config.commitsCount ||
                newConfig.expressMode !== this._config.expressMode ||
                newConfig.displayExpress !== this._config.displayExpress) {

                this._config = newConfig;
                this._onDidChangeConfiguratoin.fire(newConfig);
            }
        }, null, this._disposables);

        workspace.onDidChangeWorkspaceFolders(e => {
            this._gitService.updateGitRoots(workspace.workspaceFolders);
        }, null, this._disposables);
        this._gitService.updateGitRoots(workspace.workspaceFolders);

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
            this._historyViewContext.branch = await this._gitService.getCurrentBranch(context.repo);
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
