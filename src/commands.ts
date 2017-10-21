'use strict'

import * as path from 'path';
import * as assert from 'assert';

import { Uri, commands, Disposable, workspace, window , QuickPickItem} from 'vscode';

import { Model, HistoryViewContext } from './model';
import { HistoryViewProvider } from './historyViewProvider';
import { LineDiffViewProvider } from './lineDiffViewProvider';
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

async function selectBranch(repo: git.GitRepo): Promise<QuickPickItem[]> {
    const refs = await git.getRefs(repo);
    return refs.map(ref => {
        let description: string;
        if (ref.type === git.RefType.Head) {
            description = ref.commit;
        } else if (ref.type === git.RefType.Tag) {
            description = `Tag at ${ref.commit}`;
        } else if (ref.type === git.RefType.RemoteHead) {
            description = `Remote branch at ${ref.commit}`;
        }
        return { label: ref.name || ref.commit, description };
    });
}

interface RepoPickItem extends QuickPickItem {
    repo: git.GitRepo;
}

function selectGitRepo(): Thenable<git.GitRepo> {
    const repos: git.GitRepo[] = git.getGitRepos();
    if (repos.length === 0) {
        return null;
    }
    if (repos.length === 1) {
        return Promise.resolve(repos[0]);
    }
    const pickItems: RepoPickItem[] = repos.map(repo => {
        let label: string = '';
        assert(repo.wsFolders.length > 0, 'every git repo should have at least one workspace folder');
        repo.wsFolders.forEach(folder => label += folder.name + ', ');
        label = label.slice(0, -2);

        return { label, description: repo.root, repo };
    });
    return window.showQuickPick(pickItems, { placeHolder: 'Select the git repo' })
        .then<git.GitRepo>(item => {
            if (item) {
                return item.repo;
            }
            return null;
        });
}

async function selectAuthor(repo: git.GitRepo): Promise<QuickPickItem[]> {
    let authors = await git.getAuthors(repo);
    authors.unshift({ name: 'All', email: '' });
    return authors.map(author => { return { label: author.name, description: author.email } });
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

    constructor(private _model: Model, private _historyView: HistoryViewProvider, private _lineDiffView: LineDiffViewProvider) {
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
    async updateRef(ref: string): Promise<void> {
        selectGitRepo().then(repo => {
            if (repo) {
                this._model.filesViewContext = { leftRef: null, rightRef: ref, repo };
            }
        });
    }

    @command('githd.clear')
    async clear(): Promise<void> {
        this._model.filesViewContext = { leftRef: null, rightRef: null, specifiedPath: null, repo: null };
    }

    @command('githd.viewHistory')
    async viewHistory(): Promise<void> {
        selectGitRepo().then(repo => {
            if (repo) {
                this._viewHistory({ repo });
            }
        });
    }

    @command('githd.viewFileHistory')
    async viewFileHistory(specifiedPath: Uri): Promise<void> {
        if (specifiedPath) {
            return this._viewHistory({ specifiedPath, repo: git.getGitRepo(specifiedPath) });
        }
    }

    @command('githd.viewFolderHistory')
    async viewFolderHistory(specifiedPath: Uri): Promise<void> {
        return this.viewFileHistory(specifiedPath);
    }

    @command('githd.viewLineHistory')
    async viewLineHistory(file: Uri): Promise<void> {
        if (file) {
            const line = window.activeTextEditor.selection.active.line + 1;
            return this._viewHistory({ specifiedPath: file, line, repo: git.getGitRepo(file) });
        }
    }

    @command('githd.viewAllHistory')
    async viewAllHistory(): Promise<void> {
        return this._viewHistory(this._model.historyViewContext ? this._model.historyViewContext
            : { repo: git.getGitRepos()[0] }, true);
    }

    @command('githd.viewBranchHistory')
    async viewBranchHistory(context?: HistoryViewContext): Promise<void> {
        let placeHolder: string = `Select a ref to see it's history`;
        let repo: git.GitRepo;
        if (context) {
            repo = context.repo;
            const specifiedPath = this._model.historyViewContext.specifiedPath;
            if (specifiedPath) {
                placeHolder += ` of ${path.basename(specifiedPath.fsPath)}`;
            }
        } else {
            repo = await Promise.resolve(selectGitRepo());
            if (!repo) {
                return;
            }
        }
        placeHolder += ` (${repo.root})`;

        window.showQuickPick(selectBranch(repo), { placeHolder })
            .then(item => {
                if (item) {
                    if (context) {
                        context.branch = item.label;
                        this._viewHistory(context);
                    } else {
                        this._viewHistory({ branch: item.label, repo });
                    }
                }
            });
    }

    @command('githd.viewAuthorHistory')
    async viewAuthorHistory(): Promise<void> {
        assert(this._model.historyViewContext, 'history view context should exist');
        const context: HistoryViewContext = this._model.historyViewContext;
        let placeHolder: string = `Select a author to see his/her commits`;
        window.showQuickPick(selectAuthor(context.repo), { placeHolder })
            .then(item => {
                if (item) {
                    const email: string = item.description;
                    let context: HistoryViewContext = this._model.historyViewContext;
                    if (context) {
                        context.author = email;
                    }
                    this._viewHistory(context);
                }
            });
    }

    @command('githd.diffBranch')
    async diffBranch(): Promise<void> {
        selectGitRepo().then(async repo => {
            if (!repo) {
                return;
            }
            const currentRef: string = await git.getCurrentBranch(repo);
            window.showQuickPick(selectBranch(repo), { placeHolder: `Select a ref to see it's diff with ${currentRef} (${repo.root})` })
                .then(async item => {
                    if (item) {
                        this._model.filesViewContext = {
                            repo,
                            leftRef: item.label,
                            rightRef: currentRef,
                            specifiedPath: null
                        };
                    }
                });
        });
    }

    @command('githd.diffFile')
    async diffFile(specifiedPath: Uri): Promise<void> {
        if (specifiedPath) {
            const repo: git.GitRepo = git.getGitRepo(specifiedPath);
            window.showQuickPick(selectBranch(repo), { placeHolder: `Select a ref to see the diff of ${path.basename(specifiedPath.path)}` })
                .then(async item => {
                    if (item) {
                        const currentRef: string = await git.getCurrentBranch(repo);
                        this._model.filesViewContext = {
                            repo,
                            leftRef: item.label,
                            rightRef: currentRef,
                            specifiedPath
                        };
                    }
                });
        }
    }

    @command('githd.diffFolder')
    async diffFolder(specifiedPath: Uri): Promise<void> {
        return this.diffFile(specifiedPath);
    }

    @command('githd.inputRef')
    async inputRef(): Promise<void> {
        selectGitRepo().then(repo => {
            if (!repo) {
                return;
            }
            window.showInputBox({ placeHolder: `Input a ref(sha1) to see it's committed files` })
                .then(ref => this._model.filesViewContext = { leftRef: null, rightRef: ref, specifiedPath: null, repo });
        });
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
            title + ' | ' + path.basename(file.gitRelativePath), { preview: true });
    }

    @command('githd.openLineDiff')
    async openLineDiff(content: string): Promise<void> {
        this._lineDiffView.update(content);
        workspace.openTextDocument(LineDiffViewProvider.defaultUri)
            .then(doc => window.showTextDocument(doc, { preview: true, preserveFocus: true })
                .then(() => commands.executeCommand('cursorTop')));
    }

    @command('githd.setExpressMode')
    async setExpressMode(): Promise<void> {
        this._historyView.express = !this._historyView.express;
    }

    private async _viewHistory(context: HistoryViewContext, all: boolean = false): Promise<void> {
        this._historyView.loadAll = all;
        await this._model.setHistoryViewContext(context);
    }
}