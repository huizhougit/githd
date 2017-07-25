'use strict'

import path = require('path');

import { Uri, commands, Disposable, workspace, window , scm, QuickPickItem} from 'vscode';

import { setExplorerViewWithFolder } from './extension';
import { FileProvider } from './model';
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

    set fileProvider(provider: FileProvider) { this._fileProvider = provider; }

    constructor(private _fileProvider: FileProvider, private _viewProvider: HistoryViewProvider) {
        this._disposables = Commands.map(({ id, method }) => {
            return commands.registerCommand(id, (...args: any[]) => {
                Promise.resolve(method.apply(this, args));
            });
        });
    }
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    @command('githd.updateSha')
    async updateSha(): Promise<void> {
        await this._fileProvider.update(null, scm.inputBox.value);
    }

    @command('githd.clear')
    async clear(): Promise<void> {
        this._fileProvider.clear();
    }

    @command('githd.switch')
    async close(): Promise<void> {
        await commands.executeCommand<void>('scm.switch', ['Git']);
    }

    @command('githd.viewHistory')
    async viewHistory(): Promise<void> {
        return this._viewHistory({});
    }

    @command('githd.viewFileHistory')
    async viewFileHistory(file: Uri): Promise<void> {
        if (file) {
            return this._viewHistory({ file });
        }
        if (!window.activeTextEditor) {
            window.showInformationMessage('There is no open file');
            return;
        }
        return this._viewHistory({ file: window.activeTextEditor.document.uri });
    }

    @command('githd.viewAllHistory')
    async viewAllHistory(): Promise<void> {
        return this._viewHistory({ all: true });
    }

    @command('githd.viewBranchHistory')
    async viewBranchHistory(): Promise<void> {
        window.showQuickPick(selectBranch(), { placeHolder: `Select a ref to see it's history` }
        ).then(item => this._viewHistory({ branch: item.label, file: null }));
    }

    @command('githd.diffBranch')
    async diffBranch(): Promise<void> {
        window.showQuickPick(selectBranch(), { placeHolder: `Select a ref to see it's diff with current one` }
        ).then(async item => {
            let currentRef = await git.getCurrentBranch();
            this._fileProvider.update(item.label, currentRef);
        });
    }

    @command('githd.inputRef')
    async inputRef(): Promise<void> {
        window.showInputBox( { placeHolder: `Input a ref (sha1) to see it's committed files` }).then(ref => {
            this._fileProvider.update(null, ref);
        });
    }

    @command('githd.openCommittedFile')
    async openCommittedFile(file: git.CommittedFile): Promise<void> {
        let rightRef: string = this._fileProvider.rightRef;
        let leftRef: string = this._fileProvider.rightRef + '~';
        let title = rightRef;
        if (this._fileProvider.leftRef) {
            leftRef = this._fileProvider.leftRef;
            title = `${leftRef} .. ${rightRef}`;
        }
        return await commands.executeCommand<void>('vscode.diff', toGitUri(file.uri, leftRef), toGitUri(file.uri, rightRef),
            title + ' | ' + file.gitRelativePath, { preview: true });
    }

    @command('githd.setExplorerViewWithFolder')
    async setExplorerViewWithFolder(): Promise<void> {
        const picks = ['With Folder', 'Without Folder'];
        window.showQuickPick(picks, { placeHolder: `Set if the committed files show with folder or not` }).then(item => {
            if (item) {
                setExplorerViewWithFolder(item);
            }
        });
    }

    private async _viewHistory(context: { branch?: string, file?: Uri, all?: boolean }): Promise<void> {
        this._viewProvider.branch = context.branch;
        if (context.file !== null) { // null means we don't change current file
            this._viewProvider.specifiedFile = context.file;
        }
        this._viewProvider.update(context.all);
        workspace.openTextDocument(HistoryViewProvider.defaultUri).then(doc => {
            window.showTextDocument(doc);
            if (!this._viewProvider.loadingMore) {
                commands.executeCommand('cursorTop');
            }
        });
    }
}