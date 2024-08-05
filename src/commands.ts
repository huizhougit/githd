import * as path from 'path';
import * as assert from 'assert';

import * as vs from 'vscode';

import { Model, HistoryViewContext } from './model';
import { HistoryViewProvider } from './historyViewProvider';
import { InfoViewProvider } from './infoViewProvider';
import { GitService, GitRepo, GitRefType, GitCommittedFile } from './gitService';
import { Tracer } from './tracer';

function toGitUri(uri: vs.Uri, ref?: string): vs.Uri {
  return uri.with({
    scheme: 'git',
    path: uri.path,
    query: JSON.stringify({
      path: uri.fsPath,
      ref
    })
  });
}

async function selectBranch(
  gitService: GitService,
  repo: GitRepo,
  allowEnterSha?: boolean
): Promise<vs.QuickPickItem[]> {
  const refs = await gitService.getRefs(repo);
  const items = refs.map(ref => {
    let description: string | undefined;
    if (ref.type === GitRefType.Head) {
      description = ref.commit;
    } else if (ref.type === GitRefType.Tag) {
      description = `Tag at ${ref.commit}`;
    } else if (ref.type === GitRefType.RemoteHead) {
      description = `Remote branch at ${ref.commit}`;
    }
    return { label: ref.name || ref.commit, description };
  });
  if (allowEnterSha) items.unshift(new EnterShaPickItem());
  return items;
}

async function branchCombination(gitService: GitService, repo: GitRepo): Promise<vs.QuickPickItem[]> {
  const refs = (await gitService.getRefs(repo)).filter(ref => {
    return ref.type != GitRefType.Tag;
  });
  const localRefs = refs.filter(ref => {
    return ref.type != GitRefType.RemoteHead;
  });
  let items: vs.QuickPickItem[] = [];
  localRefs.forEach(source => {
    refs.forEach(target => {
      if (source.name != target.name && source.commit != target.commit) {
        items.push({
          label: `${source.name || source.commit} .. ${target.name || target.commit}`
        });
      }
    });
  });
  return items;
}

interface RepoPickItem extends vs.QuickPickItem {
  repo: GitRepo;
}

class EnterShaPickItem implements vs.QuickPickItem {
  label = 'Enter commit SHA';
  description = '';
  openShaTextBox = true;
}

async function selectGitRepo(gitService: GitService): Promise<GitRepo | undefined> {
  const repos: GitRepo[] = gitService.getGitRepos();
  if (repos.length === 0) {
    return;
  }
  if (repos.length === 1) {
    return repos[0];
  }
  const pickItems: RepoPickItem[] = repos.map(repo => {
    return { label: path.basename(repo.root), description: repo.root, repo };
  });
  const item = await vs.window.showQuickPick(pickItems, {
    placeHolder: 'Select the git repo'
  });
  return item?.repo;
}

async function getRefFromQuickPickItem(
  item: vs.QuickPickItem | EnterShaPickItem,
  inputBoxTitle: string
): Promise<string | undefined> {
  return (<EnterShaPickItem>item).openShaTextBox ? await vs.window.showInputBox({ prompt: inputBoxTitle }) : item.label;
}

async function selectAuthor(gitService: GitService, repo: GitRepo): Promise<vs.QuickPickItem[]> {
  let authors = await gitService.getAuthors(repo);
  authors.unshift({ name: 'All', email: '' });
  return authors.map(author => {
    return { label: author.name, description: author.email };
  });
}

interface Command {
  id: string;
  method: Function;
}

const Commands: Command[] = [];

function command(id: string) {
  return function (_target: any, _key: string, descriptor: PropertyDescriptor) {
    if (!(typeof descriptor.value === 'function')) {
      throw new Error('not supported');
    }
    Commands.push({ id, method: descriptor.value });
  };
}

export class CommandCenter {
  constructor(
    context: vs.ExtensionContext,
    private _model: Model,
    private _gitService: GitService,
    private _historyView: HistoryViewProvider,
    private _infoView: InfoViewProvider
  ) {
    context.subscriptions.push(
      ...Commands.map(({ id, method }) => {
        return vs.commands.registerCommand(id, (...args: any[]) => {
          Promise.resolve(method.apply(this, args));
        });
      })
    );
  }

  @command('githd.clearFilesView')
  clear(): void {
    Tracer.verbose('Command: githd.clearFilesView');
    this._model.clearFilesViewContexts();
  }

  @command('githd.goBackFilesView')
  goBackFilesViewContext(): void {
    this._model.goBackFilesViewContext();
  }

  @command('githd.goForwardFilesView')
  goForwardFilesViewContext(): void {
    this._model.goForwardFilesViewContext();
  }

  @command('githd.goBackNoMore')
  dummyForGoBackIcon(): void {
  }

  @command('githd.goForwardNoMore')
  dummyForGoForwardIcon(): void {
  }

  @command('githd.viewHistory')
  async viewHistory(): Promise<void> {
    Tracer.verbose('Command: githd.viewHistory');
    const repo = await selectGitRepo(this._gitService);
    if (repo) {
      this._viewHistory({ repo, branch: '' });
    }
  }

  @command('githd.viewFileHistory')
  async viewFileHistory(specifiedPath = vs.window.activeTextEditor?.document?.uri): Promise<void> {
    Tracer.verbose('Command: githd.viewFileHistory');
    if (!specifiedPath) {
      return;
    }
    let repo = await this._gitService.getGitRepo(specifiedPath.fsPath);
    if (!repo) {
      return;
    }
    return this._viewHistory({ specifiedPath, repo, branch: '' });
  }

  @command('githd.viewFolderHistory')
  async viewFolderHistory(specifiedPath: vs.Uri): Promise<void> {
    Tracer.verbose('Command: githd.viewFolderHistory');
    return this.viewFileHistory(specifiedPath);
  }

  @command('githd.viewLineHistory')
  async viewLineHistory(file = vs.window.activeTextEditor?.document?.uri): Promise<void> {
    Tracer.verbose('Command: githd.viewLineHistory');
    if (!file) {
      return;
    }

    let repo = await this._gitService.getGitRepo(file.fsPath);
    if (!repo) {
      return;
    }
    let line = vs.window.activeTextEditor?.selection?.active?.line;
    if (!line) {
      return;
    }
    line++;
    return this._viewHistory({ specifiedPath: file, line, repo, branch: '' });
  }

  @command('githd.goBackHistoryView')
  goBackHistoryView(): void {
    Tracer.verbose('Command: githd.goBackHistoryView');
    this._model.goBackHistoryViewContext();
  }

  @command('githd.goForwardHistoryView')
  goForwardHistoryView(): void {
    Tracer.verbose('Command: githd.goForwardHistoryView');
    this._model.goForwardHistoryViewContext();
  }

  @command('githd.viewAllHistory')
  async viewAllHistory(): Promise<void> {
    Tracer.verbose('Command: githd.viewAllHistory');
    let context = this._model.historyViewContext ?? {
      repo: this._gitService.getGitRepos()[0],
      branch: ''
    };
    return this._viewHistory(context, true);
  }

  @command('githd.viewBranchHistory')
  async viewBranchHistory(context?: HistoryViewContext): Promise<void> {
    Tracer.verbose('Command: githd.viewBranchHistory');
    let placeHolder: string = `Select a ref to see it's history`;
    let repo: GitRepo;
    if (context) {
      repo = context.repo;
      const specifiedPath = this._model.historyViewContext?.specifiedPath;
      if (specifiedPath) {
        placeHolder += ` of ${path.basename(specifiedPath.fsPath)}`;
      }
    } else {
      const selected = await selectGitRepo(this._gitService);
      if (!selected) {
        return;
      }
      repo = selected;
    }
    placeHolder += ` (${repo.root})`;

    vs.window.showQuickPick(selectBranch(this._gitService, repo), { placeHolder }).then(item => {
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
  viewAuthorHistory(): void {
    Tracer.verbose('Command: githd.viewAuthorHistory');
    assert(this._model.historyViewContext, 'history view context should exist');
    const context: HistoryViewContext = this._model.historyViewContext;
    let placeHolder: string = `Select a author to see his/her commits`;
    vs.window
      .showQuickPick(selectAuthor(this._gitService, context.repo), {
        placeHolder
      })
      .then(item => {
        if (item) {
          const email = item.description;
          let context = this._model.historyViewContext;
          if (context) {
            context.author = email;
            this._viewHistory(context);
          }
        }
      });
  }

  @command('githd.viewStashes')
  async viewStashes(): Promise<void> {
    Tracer.verbose('Command: githd.viewStashes');
    const repo = await selectGitRepo(this._gitService);
    if (repo) {
      this._viewHistory({ repo, isStash: true, branch: '' });
    }
  }

  @command('githd.diffBranch')
  async diffBranch(): Promise<void> {
    Tracer.verbose('Command: githd.diffBranch');
    const repo = await selectGitRepo(this._gitService);
    if (!repo) {
      return;
    }
    this._diffSelections({ repo });
  }

  @command('githd.diffFile')
  async diffFile(specifiedPath: vs.Uri): Promise<void> {
    Tracer.verbose('Command: githd.diffFile');
    return this._diffPath(specifiedPath);
  }

  @command('githd.diffFolder')
  async diffFolder(specifiedPath: vs.Uri): Promise<void> {
    Tracer.verbose('Command: githd.diffFolder');
    return this._diffPath(specifiedPath);
  }

  @command('githd.inputRef')
  async inputRef(): Promise<void> {
    Tracer.verbose('Command: githd.inputRef');
    const repo = await selectGitRepo(this._gitService);
    if (!repo) {
      return;
    }
    vs.window
      .showInputBox({
        placeHolder: `Input a ref(sha1) to see it's committed files`
      })
      .then(ref => (this._model.setFilesViewContext({ rightRef: ref?.trim(), repo })));
  }

  @command('githd.openCommit')
  openCommit(repo: GitRepo, ref: string, specifiedPath: vs.Uri): void {
    Tracer.verbose('Command: githd.openCommit');
    this._model.setFilesViewContext({ rightRef: ref, repo, specifiedPath });
  }

  @command('githd.openCommittedFile')
  openCommittedFile(file: GitCommittedFile): void {
    Tracer.verbose('Command: githd.openCommittedFile');
    let rightRef = this._model.filesViewContext?.rightRef;
    let leftRef: string = rightRef + '~';
    let title = rightRef;
    if (this._model.filesViewContext?.leftRef) {
      leftRef = this._model.filesViewContext.leftRef;
      title = `${leftRef} .. ${rightRef}`;
    }
    vs.commands.executeCommand<void>(
      'vscode.diff',
      toGitUri(file.oldFileUri, leftRef),
      toGitUri(file.fileUri, rightRef),
      title + ' | ' + path.basename(file.gitRelativePath),
      { preview: true }
    );
  }

  @command('githd.openCommitInfo')
  openCommitInfo(): void {
    Tracer.verbose('Command: githd.openCommitInfo');
    vs.workspace
      .openTextDocument(InfoViewProvider.defaultUri)
      .then(doc =>
        vs.window
          .showTextDocument(doc, { preview: true, preserveFocus: true })
          .then(() => vs.commands.executeCommand('cursorTop'))
      );
  }

  @command('githd.openLineDiff')
  openLineDiff(content: string): void {
    Tracer.verbose('Command: githd.openLineDiff');
    vs.workspace
      .openTextDocument({ content, language: 'diff' })
      .then(doc =>
        vs.window
          .showTextDocument(doc, { preview: true, preserveFocus: true, })
          .then(() => vs.commands.executeCommand('cursorTop'))
      );
  }

  @command('githd.diffUncommittedFile')
  async diffUncommittedFile(file = vs.window.activeTextEditor?.document?.uri): Promise<void> {
    if (!file) {
      return;
    }
    Tracer.verbose('Command: githd.diffUncommittedFile');

    const repo = await this._gitService.getGitRepo(file.fsPath);
    if (!repo) {
      return;
    }
    vs.window
      .showQuickPick(selectBranch(this._gitService, repo), {
        placeHolder: `Select a ref to see the diff with local copy of ${path.basename(file.path)}`
      })
      .then(async item => {
        if (item) {
          return await vs.commands.executeCommand<void>(
            'vscode.diff',
            toGitUri(file, item.label),
            file,
            `${item.label} .. Uncommitted (${path.basename(file.path)})`,
            { preview: true }
          );
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

  private async _diffPath(specifiedPath: vs.Uri): Promise<void> {
    if (specifiedPath) {
      const repo = await this._gitService.getGitRepo(specifiedPath.fsPath);
      if (repo) {
        this._diffSelections({ repo, specifiedPath });
      }
    }
  }

  private async _diffSelections({ repo, specifiedPath }: { repo: GitRepo; specifiedPath?: vs.Uri }): Promise<void> {
    const branches = await selectBranch(this._gitService, repo, true);
    const branchWithCombination = await branchCombination(this._gitService, repo);
    const items = [...branches, ...branchWithCombination];
    const currentRef = await this._gitService.getCurrentBranch(repo);
    const placeHolder: string = `Select a ref to see it's diff with ${currentRef} or select two refs to see their diffs`;
    vs.window.showQuickPick(items, { placeHolder: placeHolder }).then(async item => {
      if (!item) {
        return;
      }
      let leftRef = await getRefFromQuickPickItem(
        item,
        `Input a ref(sha1) to compare with ${currentRef} or ` + `'ref(sha1) .. ref(sha2)' to compare with two commits`
      );
      let rightRef = currentRef;
      if (!leftRef) {
        return;
      }

      if (leftRef.indexOf('..') != -1) {
        const diffBranch = leftRef.split('..');
        leftRef = diffBranch[0].trim();
        rightRef = diffBranch[1].trim();
      }

      this._model.setFilesViewContext({
        repo,
        leftRef,
        rightRef,
        specifiedPath
      });
    });
  }
}
