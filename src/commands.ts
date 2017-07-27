'use strict'

import * as path from 'path';

import { Uri, commands, Disposable, workspace, window , scm, QuickPickItem} from 'vscode';

import { Model, HistoryViewContext } from './model';
import { HistoryViewProvider } from './historyViewProvider';
import { git } from './git';

function toGitUri(uri: Uri, ref: string): Uri {
    return uri.with({
        scheme: 'git',
        path: uri.path,
        query: JSON.stringify({
            path: uri.fsPath,
            ref
        })
    });
}

async function selectBranch(): Promise<QuickPickItem[]> {
    const refs = await git.getRefs();
    return refs.map(ref => {
        let description: string;
        if (ref.type === git.RefType.Head) {
            description = ref.commit;
        } else if (ref.type === git.RefType.Tag) {
            description = `Tag at ${ref.commit}`;
        } else if (ref.type === git.RefType.RemoteHead) {
            description = `Remote branch at ${ref.commit}`;
        }
        return { label: ref.name || ref.commit, description: description };
    });
}

interface Command {
    id: string;
    method: Function;
}

const Commands: Command[] = [];

function command(id: string) {
    return function (target: any, key: string, descriptor: PropertyDescriptor) {
        if (!(typeof descriptor.value === 'function')) {
            throw new Error('not supported');
        }
        Commands.push({ id, method: descriptor.value });
    }
}

export class CommandCenter {
    private _disposables: Disposable[];

    constructor(private _model: Model, private _viewProvider: HistoryViewProvider) {
        this._disposables = Commands.map(({ id, method }) => {
            return commands.registerCommand(id, (...args: any[]) => {
                Promise.resolve(method.apply(this, args));
            });
        });
    }
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    @command('githd.updateRef')
    async updateRef(): Promise<void> {
        this._model.filesViewContext = { leftRef: null, rightRef: scm.inputBox.value };
    }

    @command('githd.clear')
    async clear(): Promise<void> {
        this._model.filesViewContext = { leftRef: null, rightRef: null, specifiedPath: null};
    }

    @command('githd.switch')
    async close(): Promise<void> {
        await commands.executeCommand<void>('scm.switch', ['Git']);
    }

    @command('githd.viewHistory')
    async viewHistory(): Promise<void> {
        return this._viewHistory({ branch: null, specifiedPath: null });
    }

    @command('githd.viewFileHistory')
    async viewFileHistory(specifiedPath: Uri): Promise<void> {
        if (specifiedPath) {
            return this._viewHistory({ branch: null, specifiedPath });
        }
        if (!window.activeTextEditor) {
            window.showInformationMessage('There is no open file');
            return;
        }
        return this._viewHistory({ specifiedPath: window.activeTextEditor.document.uri });
    }

    @command('githd.viewAllHistory')
    async viewAllHistory(): Promise<void> {
        return this._viewHistory({}, true);
    }

    @command('githd.viewBranchHistory')
    async viewBranchHistory(): Promise<void> {
        let placeHolder: string = 'Select a ref to see the history';
        const specifiedPath = this._model.historyViewContext.specifiedPath;
        if (specifiedPath) {
            placeHolder += ` of ${path.basename(specifiedPath.fsPath)}`;
        }
        window.showQuickPick(selectBranch(), { placeHolder }
        ).then(item => {
            if (item) {
                this._viewHistory({ branch: item.label });
            }
        });
    }

    @command('githd.diffBranch')
    async diffBranch(): Promise<void> {
        window.showQuickPick(selectBranch(), { placeHolder: `Select a ref to see it's diff with current one` }
        ).then(async item => {
            if (item) {
                let currentRef = await git.getCurrentBranch();
                this._model.filesViewContext = {
                    leftRef: item.label,
                    rightRef: currentRef,
                    specifiedPath: null
                };
            }
        });
    }

    @command('githd.diffFile')
    async diffFile(file: Uri): Promise<void> {
        if (file) {
            window.showQuickPick(selectBranch(), { placeHolder: `Select a ref to see the diff of ${path.basename(file.path)}` }
            ).then(async item => {
                if (item) {
                    let currentRef = await git.getCurrentBranch();
                    this._model.filesViewContext = {
                        leftRef: item.label,
                        rightRef: currentRef,
                        specifiedPath: file
                    };
                }
            });
        }
    }

    @command('githd.inputRef')
    async inputRef(): Promise<void> {
        window.showInputBox({ placeHolder: `Input a ref (sha1) to see it's committed files` }
        ).then(ref => this._model.filesViewContext = { leftRef: null, rightRef: ref, specifiedPath: null });
    }

    @command('githd.openCommittedFile')
    async openCommittedFile(file: git.CommittedFile): Promise<void> {
        let rightRef: string = this._model.filesViewContext.rightRef;
        let leftRef: string = rightRef + '~';
        let title = rightRef;
        if (this._model.filesViewContext.leftRef) {
            leftRef = this._model.filesViewContext.leftRef;
            title = `${leftRef} .. ${rightRef}`;
        }
        return await commands.executeCommand<void>('vscode.diff', toGitUri(file.uri, leftRef), toGitUri(file.uri, rightRef),
            title + ' | ' + file.gitRelativePath, { preview: true });
    }

    @command('githd.setExplorerViewWithFolder')
    async setExplorerViewWithFolder(): Promise<void> {
        const picks = ['With Folder', 'Without Folder'];
        window.showQuickPick(picks, { placeHolder: `Set if the committed files show with folder or not` }
        ).then(item => {
            if (item === picks[0] || item === picks[1]) {
                this._model.configuration = { withFolder: item === picks[0] };
            }
        });
    }

    private async _viewHistory(context: HistoryViewContext, all: boolean = false): Promise<void> {
        this._viewProvider.loadAll = all;
        if (context.branch === null) {
            context.branch = await git.getCurrentBranch();
        }
        await this._model.setHistoryViewContext(context);
        workspace.openTextDocument(HistoryViewProvider.defaultUri).then(doc => {
            window.showTextDocument(doc);
            if (!this._viewProvider.loadingMore) {
                commands.executeCommand('cursorTop');
            }
        });
    }
}