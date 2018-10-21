'use strict'

import * as path from 'path';
import * as assert from 'assert';

import { Uri, commands, Disposable, workspace, window, QuickPickItem } from 'vscode';

import { Model, HistoryViewContext } from './model';
import { HistoryViewProvider } from './historyViewProvider';
import { InfoViewProvider } from './infoViewProvider';
import { GitService, GitRepo, GitRefType, GitCommittedFile } from './gitService';
import { Tracer } from './tracer';

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

async function selectBranch(gitService: GitService, repo: GitRepo, allowEnterSha?: boolean): Promise<QuickPickItem[]> {
    const refs = await gitService.getRefs(repo);
    const items = refs.map(ref => {
        let description: string;
        if (ref.type === GitRefType.Head) {
            description = ref.commit;
        } else if (ref.type === GitRefType.Tag) {
            description = `Tag at ${ref.commit}`;
        } else if (ref.type === GitRefType.RemoteHead) {
            description = `Remote branch at ${ref.commit}`;
        }
        return { label: ref.name || ref.commit, description };
    });
    if (allowEnterSha) items.unshift(new EnterShaPickItem);
    return items;
}

async function branchCombination(gitService: GitService, repo: GitRepo): Promise<QuickPickItem[]> {
    const refs = (await gitService.getRefs(repo)).filter(ref => {
        return ref.type != GitRefType.Tag
    });
    const localRefs = refs.filter(ref => {
        return ref.type != GitRefType.RemoteHead
    })
    let items: QuickPickItem[] = []
    localRefs.forEach(source => {
        refs.forEach(target => {
            if (source.name != target.name && source.commit != target.commit) {
                items.push({label: `${source.name || source.commit} .. ${target.name || target.commit}`})
            }
        })
    })
    return items;
}

interface RepoPickItem extends QuickPickItem {
    repo: GitRepo;
}

class EnterShaPickItem implements QuickPickItem {
    label = "Enter commit SHA";
    description = "";
    openShaTextBox = true;
}

function selectGitRepo(gitService: GitService): Thenable<GitRepo> {
    const repos: GitRepo[] = gitService.getGitRepos();
    if (repos.length === 0) {
        return null;
    }
    if (repos.length === 1) {
        return Promise.resolve(repos[0]);
    }
    const pickItems: RepoPickItem[] = repos.map(repo => {
        let label: string = '';
        return { label: path.basename(repo.root), description: repo.root, repo };
    });
    return window.showQuickPick(pickItems, { placeHolder: 'Select the git repo' })
        .then<GitRepo>(item => {
            if (item) {
                return item.repo;
            }
            return null;
        });
}

async function getRefFromQuickPickItem(item: QuickPickItem | EnterShaPickItem, inputBoxTitle: string): Promise<string> {
    return (<EnterShaPickItem>item).openShaTextBox
        ? await window.showInputBox({ prompt: inputBoxTitle })
        : item.label;
}

async function selectAuthor(gitService: GitService, repo: GitRepo): Promise<QuickPickItem[]> {
    let authors = await gitService.getAuthors(repo);
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

    constructor(private _model: Model, private _gitService: GitService,
        private _historyView: HistoryViewProvider, private _infoView: InfoViewProvider) {

        this._disposables = Commands.map(({ id, method }) => {
            return commands.registerCommand(id, (...args: any[]) => {
                Promise.resolve(method.apply(this, args));
            });
        });
    }
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    @command('githd.clear')
    async clear(): Promise<void> {
        Tracer.verbose('Command: githd.clear');
        this._model.filesViewContext = { leftRef: null, rightRef: null, specifiedPath: null, repo: null };
    }

    @command('githd.viewHistory')
    async viewHistory(): Promise<void> {
        Tracer.verbose('Command: githd.viewHistory');
        selectGitRepo(this._gitService).then(repo => {
            if (repo) {
                this._viewHistory({ repo });
            }
        });
    }

    @command('githd.viewFileHistory')
    async viewFileHistory(
        specifiedPath: Uri | undefined = window.activeTextEditor ? window.activeTextEditor.document.uri : undefined
    ): Promise<void> {
        Tracer.verbose('Command: githd.viewFileHistory');
        if (!specifiedPath) {
            return;
        }
        return this._viewHistory({ specifiedPath, repo: await this._gitService.getGitRepo(specifiedPath) });
    }

    @command('githd.viewFolderHistory')
    async viewFolderHistory(specifiedPath: Uri): Promise<void> {
        Tracer.verbose('Command: githd.viewFolderHistory');
        return this.viewFileHistory(specifiedPath);
    }

    @command('githd.viewLineHistory')
    async viewLineHistory(
        file: Uri | undefined = window.activeTextEditor ? window.activeTextEditor.document.uri : undefined
    ): Promise<void> {
        Tracer.verbose('Command: githd.viewLineHistory');
        if (!file) {
            return;
        }
        const line = window.activeTextEditor && window.activeTextEditor.selection.active.line + 1;
        if (!line) {
            return;
        }
        return this._viewHistory({ specifiedPath: file, line, repo: await this._gitService.getGitRepo(file) });
    }

    @command('githd.viewAllHistory')
    async viewAllHistory(): Promise<void> {
        Tracer.verbose('Command: githd.viewAllHistory');
        let context = this._model.historyViewContext ? this._model.historyViewContext : { repo: this._gitService.getGitRepos()[0] };
        context.isStash = false;
        return this._viewHistory(context, true);
    }

    @command('githd.viewBranchHistory')
    async viewBranchHistory(context?: HistoryViewContext): Promise<void> {
        Tracer.verbose('Command: githd.viewBranchHistory');
        let placeHolder: string = `Select a ref to see it's history`;
        let repo: GitRepo;
        if (context) {
            repo = context.repo;
            const specifiedPath = this._model.historyViewContext.specifiedPath;
            if (specifiedPath) {
                placeHolder += ` of ${path.basename(specifiedPath.fsPath)}`;
            }
        } else {
            repo = await Promise.resolve(selectGitRepo(this._gitService));
            if (!repo) {
                return;
            }
        }
        placeHolder += ` (${repo.root})`;

        window.showQuickPick(selectBranch(this._gitService, repo), { placeHolder })
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
        Tracer.verbose('Command: githd.viewAuthorHistory');
        assert(this._model.historyViewContext, 'history view context should exist');
        const context: HistoryViewContext = this._model.historyViewContext;
        let placeHolder: string = `Select a author to see his/her commits`;
        window.showQuickPick(selectAuthor(this._gitService, context.repo), { placeHolder })
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

    @command('githd.viewStashes')
    async viewStashes(): Promise<void> {
        Tracer.verbose('Command: githd.viewStashes');
        selectGitRepo(this._gitService).then(repo => {
            if (repo) {
                this._viewHistory({ repo, isStash: true });
            }
        });
    }

    @command('githd.diffBranch')
    async diffBranch(): Promise<void> {
        Tracer.verbose('Command: githd.diffBranch');
        selectGitRepo(this._gitService).then(async repo => {
            if (!repo) {
                return;
            }
            this._diffSelections(repo);
        });
    }

    @command('githd.diffFile')
    async diffFile(specifiedPath: Uri): Promise<void> {
        Tracer.verbose('Command: githd.diffFile');
        return this._diffPath(specifiedPath);
    }

    @command('githd.diffFolder')
    async diffFolder(specifiedPath: Uri): Promise<void> {
        Tracer.verbose('Command: githd.diffFolder');
        return this._diffPath(specifiedPath);
    }

    @command('githd.inputRef')
    async inputRef(): Promise<void> {
        Tracer.verbose('Command: githd.inputRef');
        selectGitRepo(this._gitService).then(repo => {
            if (!repo) {
                return;
            }
            window.showInputBox({ placeHolder: `Input a ref(sha1) to see it's committed files` })
                .then(ref => this._model.filesViewContext = { rightRef: ref.trim(), specifiedPath: null, repo });
        });
    }

    @command('githd.openCommit')
    async openCommit(repo: GitRepo, ref: string, specifiedPath: Uri): Promise<void> {
        Tracer.verbose('Command: githd.openCommit');
        this._model.filesViewContext = { rightRef: ref, repo, specifiedPath };
    }

    @command('githd.openCommittedFile')
    async openCommittedFile(file: GitCommittedFile): Promise<void> {
        Tracer.verbose('Command: githd.openCommittedFile');
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

    @command('githd.openCommitInfo')
    async openCommitInfo(content: string): Promise<void> {
        Tracer.verbose('Command: githd.openCommitInfo');
        this._infoView.update(content);
        workspace.openTextDocument(InfoViewProvider.defaultUri)
            .then(doc => window.showTextDocument(doc, { preview: true, preserveFocus: true })
                .then(() => commands.executeCommand('cursorTop')));
    }

    @command('githd.diffUncommittedFile')
    async diffUncommittedFile(file: Uri | undefined = window.activeTextEditor ? window.activeTextEditor.document.uri : undefined)
        : Promise<void> {
        if (!file) {
            return;
        }
        Tracer.verbose('Command: githd.diffUncommittedFile');

        const repo: GitRepo = await this._gitService.getGitRepo(file);
        window.showQuickPick(selectBranch(this._gitService, repo),
            { placeHolder: `Select a ref to see the diff with local copy of ${path.basename(file.path)}` })
            .then(async item => {
                if (item) {
                    return await commands.executeCommand<void>('vscode.diff', toGitUri(file, item.label), file,
                    `${item.label} .. Uncommitted (${path.basename(file.path)})`, { preview: true });
                }
            });
    }

    @command('githd.setExpressMode')
    async setExpressMode(): Promise<void> {
        Tracer.verbose('Command: githd.setExpressMode');
        this._historyView.express = !this._historyView.express;
    }

    private async _viewHistory(context: HistoryViewContext, all: boolean = false): Promise<void> {
        this._historyView.loadAll = all;
        await this._model.setHistoryViewContext(context);
    }

    private async _diffPath(specifiedPath: Uri): Promise<void> {
        if (specifiedPath) {
            const repo: GitRepo = await this._gitService.getGitRepo(specifiedPath);
            return this._diffSelections(repo, specifiedPath);
        }
    }

    private async _diffSelections(repo: GitRepo, specifiedPath?: Uri): Promise<void> {
        const branchs: QuickPickItem[] = await selectBranch(this._gitService, repo, true);
        const branchWithCombination: QuickPickItem[] = await branchCombination(this._gitService, repo);
        const items: QuickPickItem[] = [...branchs, ...branchWithCombination];
        const currentRef: string = await this._gitService.getCurrentBranch(repo);
        const placeHolder: string = `Select a ref to see it's diff with ${currentRef} or select two refs to see their diffs`;
        window.showQuickPick(items, { placeHolder: placeHolder }).then(async item => {
            if (!item) {
                return;
            }
            let leftRef = await getRefFromQuickPickItem(item, `Input a ref(sha1) to compare with ${currentRef} or ` +
                `'ref(sha1) .. ref(sha2)' to compare with two commits`);
            let rightRef = currentRef;
            if (!leftRef) {
                return;
            }

            if (leftRef.indexOf('..') != -1) {
                const diffBranch = leftRef.split('..');
                leftRef = diffBranch[0].trim();
                rightRef = diffBranch[1].trim();
            }

            this._model.filesViewContext = {
                repo,
                leftRef,
                rightRef,
                specifiedPath
            };
        });
    }
}
