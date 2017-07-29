'use strict'

import { Uri, workspace, Event, EventEmitter, Disposable } from 'vscode';

import { ScmViewProvider } from './scmViewProvider';
import { ExplorerViewProvider } from './explorerViewProvider';
import { git } from './git';

export interface Configuration {
    readonly useExplorer?: boolean;
    readonly commitsCount?: number;
    withFolder?: boolean;
}

export interface FilesViewContext {
    leftRef?: string;
    rightRef?: string;
    specifiedPath?: Uri;
}

export interface HistoryViewContext {
    branch?: string;
    specifiedPath?: Uri;
}

function getConfiguration(): Configuration {
    return {
        useExplorer: <boolean>workspace.getConfiguration('githd.committedFiles').get('inExplorerView'),
        withFolder: <boolean>workspace.getConfiguration('githd.explorerView').get('withFolder'),
        commitsCount: <number>workspace.getConfiguration('githd.logView').get('commitsCount')
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
    private _leftRef: string;
    private _rightRef: string;
    private _specifiedPath: Uri;
    private _branch: string;

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
                newConfig.commitsCount !== this._config.commitsCount) {

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

        this._disposables.push(this._onDidChangeConfiguratoin);
        this._disposables.push(this._onDidChangeFilesViewContext);
        this._disposables.push(this._onDidChangeHistoryViewContext);
    }

    get configuration(): Configuration { return this._config; }

    get filesViewContext(): FilesViewContext {
        return {
            leftRef: this._leftRef,
            rightRef: this._rightRef,
            specifiedPath: this._specifiedPath
        }
    }
    set filesViewContext(context: FilesViewContext) {
        let changed = false;
        if (context.leftRef !== undefined && context.leftRef !== this._leftRef) {
            this._leftRef = context.leftRef;
            changed = true;
        }
        if (context.rightRef !== undefined && context.rightRef !== this._rightRef) {
            this._rightRef = context.rightRef;
            changed = true;
        }
        if (context.specifiedPath !== undefined && !sameUri(context.specifiedPath, this._specifiedPath)) {
            this._specifiedPath = context.specifiedPath;
            changed = true;
        }

        if (changed) {
            this._emitFilesViewContextChanged();
        }
    }

    get historyViewContext(): HistoryViewContext {
        return {
            branch: this._branch,
            specifiedPath: this._specifiedPath
        };
    }
    async setHistoryViewContext(context: HistoryViewContext) {
        if (!this._branch && !context.branch) {
            this._branch = await git.getCurrentBranch();
        }
        if (context.branch && context.branch !== this._branch) {
            this._branch = context.branch;
        }
        if (context.specifiedPath !== undefined && !sameUri(context.specifiedPath, this._specifiedPath)) {
            this._specifiedPath = context.specifiedPath;
        }

        this._onDidChangeHistoryViewContext.fire({
            branch: this._branch,
            specifiedPath: this._specifiedPath
        });
    }

    get onDidChangeConfiguration(): Event<Configuration> { return this._onDidChangeConfiguratoin.event; }
    get onDidChangeFilesViewContext(): Event<FilesViewContext> { return this._onDidChangeFilesViewContext.event; }
    get onDidChangeHistoryViewContext(): Event<HistoryViewContext> { return this._onDidChangeHistoryViewContext.event; }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    private _emitFilesViewContextChanged(): void {
        this._onDidChangeFilesViewContext.fire({
            leftRef: this._leftRef,
            rightRef: this._rightRef,
            specifiedPath: this._specifiedPath
        });
    }
}
