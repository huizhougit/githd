'use strict'

import { Uri, workspace, Event, EventEmitter, Disposable, commands } from 'vscode';

import { GitService, GitRepo } from './gitService';
import { Tracer } from './tracer';

export interface Configuration {
    readonly commitsCount?: number;
    readonly expressMode?: boolean;
    readonly displayExpress?: boolean;
    readonly traceLevel?: string;
    readonly blameEnabled?: boolean;
    readonly disabledInEditor?: boolean;
    withFolder?: boolean;
}

export interface FilesViewContext {
    repo: GitRepo;
    isStash?: boolean;
    leftRef?: string;
    rightRef?: string;
    specifiedPath?: Uri;
    focusedLineInfo?: string;
}

export interface HistoryViewContext {
    repo: GitRepo;
    isStash?: boolean;
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
        displayExpress: <boolean>workspace.getConfiguration('githd.logView').get('displayExpressStatus'),
        blameEnabled: <boolean>workspace.getConfiguration('githd.blameView').get('enabled'),
        disabledInEditor: <boolean>workspace.getConfiguration('githd.editor').get('disabled'),
        traceLevel: <string>workspace.getConfiguration('githd').get('traceLevel')
    };
}

export class Model {
    private _config: Configuration;

    private _historyViewContext: HistoryViewContext;
    private _filesViewContext: FilesViewContext;

    private _onDidChangeConfiguratoin = new EventEmitter<Configuration>();
    private _onDidChangeFilesViewContext = new EventEmitter<FilesViewContext>();
    private _onDidChangeHistoryViewContext = new EventEmitter<HistoryViewContext>();

    private _disposables: Disposable[] = [];

    constructor(private _gitService: GitService) {
        this._config = getConfiguration();
        Tracer.level = this._config.traceLevel;

        workspace.onDidChangeConfiguration(() => {
            let newConfig = getConfiguration();
            if (newConfig.withFolder !== this._config.withFolder ||
                newConfig.commitsCount !== this._config.commitsCount ||
                newConfig.expressMode !== this._config.expressMode ||
                newConfig.displayExpress !== this._config.displayExpress ||
                newConfig.blameEnabled !== this._config.blameEnabled ||
                newConfig.disabledInEditor !== this._config.disabledInEditor ||
                newConfig.traceLevel !== this._config.traceLevel) {

                Tracer.info(`Model: configuration updated ${JSON.stringify(newConfig)}`);
                this._config = newConfig;
                this._onDidChangeConfiguratoin.fire(newConfig);
                Tracer.level = newConfig.traceLevel;
                commands.executeCommand('setContext', 'disableInEditor', newConfig.disabledInEditor);
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
        Tracer.info(`Model: set filesViewContext - ${JSON.stringify(context)}`);

        if (!this._filesViewContext) {
            this._filesViewContext = context;
            this._onDidChangeFilesViewContext.fire(this._filesViewContext);
        } else if (this._filesViewContext.leftRef != context.leftRef
            || this._filesViewContext.rightRef != context.rightRef
            || this._filesViewContext.specifiedPath != context.specifiedPath
            || this._filesViewContext.focusedLineInfo != context.focusedLineInfo) {

            this._filesViewContext = context;
            this._onDidChangeFilesViewContext.fire(this._filesViewContext);
        }
        commands.executeCommand('workbench.view.extension.githd-explorer');
    }

    get historyViewContext(): HistoryViewContext {
        return this._historyViewContext;
    }
    async setHistoryViewContext(context: HistoryViewContext) {
        Tracer.info(`Model: set historyViewContext - ${JSON.stringify(context)}`);

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
