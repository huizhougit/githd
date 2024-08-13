import * as path from 'path';
import * as fs from 'fs';
import * as vs from 'vscode';

import { GitService, GitCommittedFile } from './gitService';
import { Model, FilesViewContext } from './model';
import { getIconUri } from './icons';
import { Tracer } from './tracer';
import { Resource } from './resource';
import { Dataloader } from './dataloader';

const rootFolderIcon = {
  dark: getIconUri('structure', 'dark'),
  light: getIconUri('structure', 'light')
};

class InfoItem extends vs.TreeItem {
  constructor(label: string) {
    super(label);
    this.contextValue = 'infoFile';
    this.command = {
      title: '',
      command: 'githd.openCommitInfo'
    };
    this.iconPath = getIconUri('info', '');
  }

  readonly parent = undefined;
}

class LineDiffItem extends vs.TreeItem {
  constructor(content: string) {
    super('Line diff');
    this.command = {
      title: '',
      command: 'githd.openLineDiff',
      arguments: [content]
    };
    this.iconPath = getIconUri('info', '');
  }

  readonly parent = undefined;
}

class CommittedFileItem extends vs.TreeItem {
  static authority: string = 'files';
  constructor(readonly parent: FolderItem, readonly file: GitCommittedFile, label: string) {
    super(label);
    this.contextValue = 'file';
    this.command = {
      title: '',
      command: 'githd.openCommittedFile',
      arguments: [this.file]
    };
    this.resourceUri = vs.Uri.from({
      scheme: ExplorerViewProvider.scheme,
      authority: CommittedFileItem.authority,
      path: '/' + file.gitRelativePath,
      query: `status=${file.status}`
    });
    this.tooltip = file.stat;
  }
}

class FolderItem extends vs.TreeItem {
  static authority: string = 'folders';

  private _subFolders: FolderItem[] = [];
  private _files: CommittedFileItem[] = [];
  private _infoItem: InfoItem | undefined;

  constructor(
    context: string,
    private _parent: FolderItem | undefined,
    private _gitRelativePath: string,
    label: string,
    iconPath?: { light: vs.Uri; dark: vs.Uri }
  ) {
    super(label);
    this.resourceUri = vs.Uri.from({
      scheme: ExplorerViewProvider.scheme,
      authority: FolderItem.authority,
      path: '/' + this._gitRelativePath
    });
    this.contextValue = context;
    this.iconPath = iconPath;
    this.collapsibleState = vs.TreeItemCollapsibleState.Expanded;
  }

  readonly parent = this._parent;
  readonly gitRelativePath: string = this._gitRelativePath;
  get subFolders(): FolderItem[] {
    return this._subFolders;
  }
  set subFolders(value: FolderItem[]) {
    this._subFolders = value;
  }
  get files(): CommittedFileItem[] {
    return this._files;
  }
  set files(value: CommittedFileItem[]) {
    this._files = value;
  }
  get infoItem(): InfoItem | undefined {
    return this._infoItem;
  }
  set infoItem(value: InfoItem | undefined) {
    this._infoItem = value;
  }
}

function getFormattedLabel(relativePath: string): string {
  const name: string = path.basename(relativePath);
  let dir: string = path.dirname(relativePath);
  if (dir === '.') {
    dir = '';
  }
  return name + ' \u00a0\u2022\u00a0 ' + dir;
}

function createCommittedFileItem(rootFolder: FolderItem, file: GitCommittedFile): CommittedFileItem {
  return new CommittedFileItem(rootFolder, file, getFormattedLabel(file.gitRelativePath));
}

function buildOneFileWithFolder(rootFolder: FolderItem, file: GitCommittedFile, relativePath: string = '') {
  const segments: string[] = relativePath
    ? path.relative(relativePath, file.gitRelativePath).split(/\\|\//)
    : file.gitRelativePath.split('/');
  let gitRelativePath: string = relativePath;
  let parent: FolderItem = rootFolder;
  let i = 0;
  for (; i < segments.length - 1; ++i) {
    gitRelativePath += segments[i] + '/';
    let folder = parent.subFolders.find(item => {
      return item.label === segments[i];
    });
    if (!folder) {
      folder = new FolderItem('folder', parent, gitRelativePath, segments[i]);
      parent.subFolders.push(folder);
    }
    parent = folder;
  }
  parent.files.push(new CommittedFileItem(parent, file, segments[i]));
}

function buildFileTree(rootFolder: FolderItem, files: GitCommittedFile[], withFolder: boolean) {
  if (withFolder) {
    files.forEach(file => buildOneFileWithFolder(rootFolder, file));
  } else {
    rootFolder.files.push(
      ...files.map(file => {
        return createCommittedFileItem(rootFolder, file);
      })
    );
  }
}

function buildFilesWithoutFolder(rootFolder: FolderItem, folder: FolderItem) {
  rootFolder.files.push(
    ...folder.files.map(item => {
      item.label = getFormattedLabel(
        path.relative(rootFolder.gitRelativePath, item.file.gitRelativePath).replace(/\\/g, '/')
      );
      return item;
    })
  );
  folder.subFolders.forEach(f => buildFilesWithoutFolder(rootFolder, f));
  folder.files = [];
  folder.subFolders = [];
}

function buildFilesWithFolder(rootFolder: FolderItem) {
  rootFolder.subFolders.forEach(folder => buildFilesWithFolder(folder));
  const files: CommittedFileItem[] = rootFolder.files;
  rootFolder.files = [];
  files.forEach(fileItem => buildOneFileWithFolder(rootFolder, fileItem.file, rootFolder.gitRelativePath));
}

type CommittedTreeItem = CommittedFileItem | FolderItem | InfoItem;

enum RootCommitPosition {
  Current = 0,
  Previous = 1,
  Next = 2
}

export class ExplorerViewProvider implements vs.TreeDataProvider<CommittedTreeItem>, vs.FileDecorationProvider {
  static scheme: string = 'githd-committed';

  private _onDidChange = new vs.EventEmitter<CommittedTreeItem | undefined>();
  private _withFolder: boolean;

  private _context: FilesViewContext | undefined;
  private _treeRoot: (FolderItem | InfoItem)[] = [];
  private _rootCommitPosition: RootCommitPosition = RootCommitPosition.Current;

  constructor(
    context: vs.ExtensionContext,
    private _model: Model,
    private _dataloader: Dataloader,
    private _gitService: GitService
  ) {
    vs.window.createTreeView('githd.files', { treeDataProvider: this });
    context.subscriptions.push(
      vs.window.registerFileDecorationProvider(this),
      vs.commands.registerCommand('githd.showFilesTreeView', (folder: FolderItem) => this._showFilesTreeView(folder)),
      vs.commands.registerCommand('githd.showFilesListView', (folder: FolderItem) => this._showFilesListView(folder)),
      vs.commands.registerCommand('githd.collapseFolder', (folder: FolderItem) =>
        this._setCollapsibleStateOnAll(folder, vs.TreeItemCollapsibleState.Collapsed)
      ),
      vs.commands.registerCommand('githd.expandFolder', (folder: FolderItem) =>
        this._setCollapsibleStateOnAll(folder, vs.TreeItemCollapsibleState.Expanded)
      ),
      vs.commands.registerCommand('githd.viewFileHistoryFromTree', (fileItem: CommittedFileItem) => {
        if (!this._context) {
          Tracer.warning('ExplorerViewProvider: viewFileHistoryFromTree has empty context');
          return;
        }
        this._model.setHistoryViewContext({
          repo: this._context.repo,
          specifiedPath: fileItem.file.fileUri,
          branch: ''
        });
      }),
      vs.commands.registerCommand('githd.viewFolderHistoryFromTree', (folder: FolderItem) => {
        if (!this._context) {
          Tracer.warning('ExplorerViewProvider: viewFolderHistoryFromTree has empty context');
          return;
        }
        this._model.setHistoryViewContext({
          repo: this._context.repo,
          specifiedPath: vs.Uri.file(path.join(this._context.repo.root, folder.gitRelativePath)),
          branch: ''
        });
      }),
      vs.commands.registerCommand('githd.diffFileFromTreeView', (fileItem: CommittedFileItem) => {
        if (!this._context?.rightRef) {
          Tracer.warning('ExplorerViewProvider: diffFileFromTreeView has empty commit ref');
          return;
        }
        vs.commands.executeCommand('githd.diffFile', fileItem.file.fileUri, this._context.rightRef);
      }),
      vs.commands.registerCommand('githd.diffFolderFromTreeView', (folder: FolderItem) => {
        if (!this._context?.rightRef) {
          Tracer.warning('ExplorerViewProvider: diffFolderFromTreeView has empty commit ref');
          return;
        }
        vs.commands.executeCommand(
          'githd.diffFolder',
          vs.Uri.file(path.join(this._context.repo.root, folder.gitRelativePath)),
          this._context.rightRef
        );
      }),
      vs.commands.registerCommand('githd.openFile', (fileItem: CommittedFileItem) => {
        vs.commands.executeCommand('vscode.open', fileItem.file.fileUri);
      }),
      this._onDidChange
    );

    this._model.onDidChangeFilesViewContext(
      context => {
        if (JSON.stringify(this._context) === JSON.stringify(context)) {
          return;
        }
        this._context = context;
        this._update();
      },
      null,
      context.subscriptions
    );

    this._context = this._model.filesViewContext;
    this._withFolder = this._model.configuration.withFolder;
    this._update();
  }

  provideFileDecoration(uri: vs.Uri, token: vs.CancellationToken): vs.ProviderResult<vs.FileDecoration> {
    if (uri.scheme !== ExplorerViewProvider.scheme) {
      return;
    }

    const badge: string = uri.query.split('=')[1];
    if (uri.authority === CommittedFileItem.authority && badge) {
      return new vs.FileDecoration(badge, undefined, Resource.getGitStatusColor(badge));
    }
  }

  readonly onDidChangeTreeData: vs.Event<CommittedTreeItem | undefined> = this._onDidChange.event;

  getTreeItem(element: CommittedTreeItem): CommittedTreeItem {
    return element;
  }

  async getChildren(element?: CommittedTreeItem): Promise<CommittedTreeItem[]> {
    if (!element) {
      // build the tree here so that we can show the loading indicator
      await this._build();
      return this._treeRoot;
    }
    let items: CommittedTreeItem[] = [];
    let folder = element as FolderItem;
    if (folder) {
      items = [...folder.subFolders, ...folder.files];
      if (folder.infoItem) {
        items.push(folder.infoItem);
      }
    }
    return items;
  }

  getParent(element: CommittedTreeItem): vs.ProviderResult<CommittedTreeItem> {
    return element.parent;
  }

  showPreviousCommit(): void {
    if (this._rootCommitPosition != RootCommitPosition.Current) {
      // the previous show operation may be in progress
      Tracer.warning('showPreviousCommit: _rootCommitType should be RootCommitType.Current');
      return;
    }
    this._rootCommitPosition = RootCommitPosition.Previous;
    this._onDidChange.fire(undefined);
  }

  showNextCommit(): void {
    if (this._rootCommitPosition != RootCommitPosition.Current) {
      // the previous show operation may be in progress
      Tracer.warning('showNextCommit: _rootCommitType should be RootCommitType.Current');
      return;
    }
    this._rootCommitPosition = RootCommitPosition.Next;
    this._onDidChange.fire(undefined);
  }

  private get commitOrStashString(): string {
    return this._context?.isStash ? 'Stash' : 'Commit';
  }

  private _isCommitsView(): boolean {
    // this._context.leftRef is set when comparing differences between two commits
    return !this._context?.isStash && !!this._context?.rightRef && !this._context?.leftRef;
  }

  private async _build(): Promise<void> {
    if (this._rootCommitPosition === RootCommitPosition.Current) {
      return this._buildCurrentCommit();
    }
    return this._buildNeighborCommit();
  }

  private async _buildCurrentCommit(): Promise<void> {
    if (!this._context) {
      vs.commands.executeCommand('setContext', 'githd.hasPreviousCommit', false);
      vs.commands.executeCommand('setContext', 'githd.hasNextCommit', false);
      return;
    }

    const leftRef = this._context.leftRef;
    const rightRef = this._context.rightRef;
    const specifiedPath = this._context.specifiedPath;
    const lineInfo = this._context.focusedLineInfo;

    if (!rightRef) {
      return;
    }

    // Update related contexts asynchronously
    Promise.resolve().then(async () => {
      if (this._isCommitsView()) {
        vs.commands.executeCommand('setContext', 'githd.commitsView', true);
        const [hasPrevious, hasNext] = await this._dataloader.hasNeighborCommits(this._context?.repo, rightRef);
        vs.commands.executeCommand('setContext', 'githd.hasPreviousCommit', hasPrevious);
        vs.commands.executeCommand('setContext', 'githd.hasNextCommit', hasNext);
      } else {
        vs.commands.executeCommand('setContext', 'githd.hasPreviousCommit', false);
        vs.commands.executeCommand('setContext', 'githd.hasNextCommit', false);
        vs.commands.executeCommand('setContext', 'githd.commitsView', false);
      }
    });

    const [stats, committedFiles]: [string, GitCommittedFile[]] = await this._gitService.getCommittedFiles(
      this._context.repo,
      rightRef,
      leftRef,
      this._context.isStash
    );
    if (!leftRef) {
      await this._buildCommitInfo(stats);
    }
    if (!leftRef && !specifiedPath) {
      this._buildCommitTree(committedFiles, rightRef);
    } else if (leftRef && !specifiedPath) {
      this._buildDiffBranchTree(committedFiles, leftRef, rightRef);
    } else if (!leftRef && specifiedPath) {
      await this._buildPathSpecifiedCommitTree(committedFiles, specifiedPath, rightRef, lineInfo);
    } else {
      await this._buildPathSpecifiedDiffBranchTree(committedFiles, this._context);
    }
  }

  private async _buildNeighborCommit(): Promise<void> {
    const position: RootCommitPosition = this._rootCommitPosition;
    this._rootCommitPosition = RootCommitPosition.Current;

    if (!this._context?.rightRef) {
      return;
    }

    const repo = this._context.repo;
    const ref = this._context.rightRef;
    const commit: string =
      position === RootCommitPosition.Previous
        ? await this._dataloader.getPreviousCommit(repo, ref)
        : await this._dataloader.getNextCommit(repo, ref);
    if (commit) {
      this._context = { rightRef: commit, repo: this._context.repo };
      this._treeRoot = [];
      await this._buildCurrentCommit();
      this._model.setFilesViewContext(this._context);
    }
  }

  private async _update(): Promise<void> {
    this._treeRoot = [];
    this._rootCommitPosition = RootCommitPosition.Current;
    this._onDidChange.fire(undefined);
  }

  private async _buildCommitInfo(stats: string): Promise<void> {
    this._treeRoot.push(new InfoItem(`${this.commitOrStashString} Info \u00a0 ${stats}`));
  }

  private _buildCommitTree(files: GitCommittedFile[], ref: string) {
    this._buildCommitFolder(`${this.commitOrStashString} ${ref} \u00a0 (${files.length} files changed)`, files);
  }

  private _buildDiffBranchTree(files: GitCommittedFile[], leftRef: string, rightRef: string) {
    this._buildCommitFolder(`Diffs between ${leftRef} and ${rightRef} \u00a0 (${files.length} files)`, files);
  }

  private async _buildPathSpecifiedCommitTree(
    files: GitCommittedFile[],
    specifiedPath: vs.Uri,
    ref: string,
    lineInfo?: string
  ): Promise<void> {
    await this._buildFocusFolder('Focus', files, specifiedPath, lineInfo);
    this._buildCommitTree(files, ref);
  }

  private async _buildPathSpecifiedDiffBranchTree(files: GitCommittedFile[], context: FilesViewContext): Promise<void> {
    if (context.specifiedPath) {
      await this._buildFocusFolder(`${context.leftRef} .. ${context.rightRef}`, files, context.specifiedPath);
    }
  }

  private _buildCommitFolder(label: string, committedFiles: GitCommittedFile[]) {
    let folder = new FolderItem('infoFolder', undefined, '', label, rootFolderIcon);
    buildFileTree(folder, committedFiles, this._withFolder);
    this._treeRoot.push(folder);
  }

  private async _buildFocusFolder(
    label: string,
    committedFiles: GitCommittedFile[],
    specifiedPath: vs.Uri,
    lineInfo?: string
  ): Promise<void> {
    let folder = new FolderItem('infoFolder', undefined, '', label, rootFolderIcon);
    const relativePath = await this._gitService.getGitRelativePath(specifiedPath);
    if (fs.lstatSync(specifiedPath.fsPath).isFile()) {
      if (lineInfo) {
        folder.infoItem = new LineDiffItem(lineInfo);
      }
      let file = committedFiles.find(value => {
        return value.gitRelativePath === relativePath;
      });
      if (file) {
        folder.files.push(createCommittedFileItem(folder, file));
      }
    } else {
      let focus: GitCommittedFile[] = [];
      committedFiles.forEach(file => {
        if (relativePath && file.gitRelativePath.search(relativePath) === 0) {
          focus.push(file);
        }
      });
      buildFileTree(folder, focus, this._withFolder);
    }
    if (folder.files.length + folder.subFolders.length > 0 || folder.infoItem) {
      this._treeRoot.push(folder);
    }
  }

  private _showFilesTreeView(parent: FolderItem) {
    if (!parent) {
      this._withFolder = true;
      this._update();
    } else {
      buildFilesWithFolder(parent);
      this._onDidChange.fire(parent);
    }
  }

  private _showFilesListView(parent: FolderItem) {
    if (!parent) {
      this._withFolder = false;
      this._update();
    } else {
      parent.subFolders.forEach(folder => buildFilesWithoutFolder(parent, folder));
      parent.subFolders = [];
      this._onDidChange.fire(parent);
    }
  }

  private _setCollapsibleState(folder: FolderItem, state: vs.TreeItemCollapsibleState) {
    if (folder) {
      folder.collapsibleState = state;
      folder.subFolders.forEach(sub => this._setCollapsibleState(sub, state));
    }
  }

  private _setCollapsibleStateOnAll(folder: FolderItem, state: vs.TreeItemCollapsibleState) {
    // Hack: change the folder label to trigger the tree view to refresh
    if (folder.label?.toString().endsWith(' ')) {
      folder.label = folder.label.toString().slice(0, -1);
    } else {
      folder.label += ' ';
    }

    this._setCollapsibleState(folder, state);
    this._onDidChange.fire(folder.parent);
  }
}
