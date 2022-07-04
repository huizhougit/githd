import * as path from 'path';
import * as fs from 'fs';

import * as vs from 'vscode';

import { GitService, GitCommittedFile } from './gitService';
import { Model, FilesViewContext } from './model';
import { Icons, getIconUri } from './icons';

const rootFolderIcon = {
  dark: getIconUri('structure', 'dark'),
  light: getIconUri('structure', 'light')
};

class InfoItem extends vs.TreeItem {
  constructor(content: string, label: string) {
    super(label);
    this.command = {
      title: '',
      command: 'githd.openCommitInfo',
      arguments: [content]
    };
    this.iconPath = getIconUri('info', '');
  }

  readonly parent = undefined;
}

class CommittedFileItem extends vs.TreeItem {
  constructor(readonly parent: FolderItem, readonly file: GitCommittedFile, label: string) {
    super(label);
    this.command = {
      title: '',
      command: 'githd.openCommittedFile',
      arguments: [this.file]
    };
    if (this.file.status) {
      this.iconPath = {
        light: this._getIconPath('light'),
        dark: this._getIconPath('dark')
      };
    }
  }

  private _getIconPath(theme: string): vs.Uri {
    switch (this.file.status[0].toUpperCase()) {
      case 'M':
        return Icons[theme].Modified;
      case 'A':
        return Icons[theme].Added;
      case 'D':
        return Icons[theme].Deleted;
      case 'R':
        return Icons[theme].Renamed;
      case 'C':
        return Icons[theme].Copied;
      default:
        throw new Error('Unknown git status: ' + this.file.status[0].toUpperCase());
    }
  }
}

class FolderItem extends vs.TreeItem {
  private _subFolders: FolderItem[] = [];
  private _files: CommittedFileItem[] = [];
  private _infoItem: InfoItem | undefined;

  constructor(
    private _parent: FolderItem | undefined,
    private _gitRelativePath: string,
    label: string,
    iconPath?: { light: vs.Uri; dark: vs.Uri }
  ) {
    super(label);
    this.contextValue = 'folder';
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
      folder = new FolderItem(parent, gitRelativePath, segments[i]);
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

function setCollapsibleStateOnAll(rootFolder: FolderItem, state: vs.TreeItemCollapsibleState) {
  if (rootFolder) {
    rootFolder.collapsibleState = state;
    rootFolder.subFolders.forEach(sub => setCollapsibleStateOnAll(sub, state));
  }
}

type CommittedTreeItem = CommittedFileItem | FolderItem | InfoItem;

export class ExplorerViewProvider implements vs.TreeDataProvider<CommittedTreeItem> {
  private _onDidChange = new vs.EventEmitter<CommittedTreeItem | undefined>();
  private _withFolder: boolean;

  private _context: FilesViewContext | undefined;
  private _treeRoot: (FolderItem | InfoItem)[] = [];

  constructor(context: vs.ExtensionContext, model: Model, private _gitService: GitService) {
    context.subscriptions.push(
      vs.window.registerTreeDataProvider('committedFiles', this),
      vs.commands.registerCommand('githd.showFilesWithFolder', (folder: FolderItem) =>
        this._showFilesWithFolder(folder)
      ),
      vs.commands.registerCommand('githd.showFilesWithoutFolder', (folder: FolderItem) =>
        this._showFilesWithoutFolder(folder)
      ),
      vs.commands.registerCommand('githd.collapseFolder', (folder: FolderItem) =>
        this._setCollapsibleStateOnAll(folder, vs.TreeItemCollapsibleState.Collapsed)
      ),
      vs.commands.registerCommand('githd.expandFolder', (folder: FolderItem) =>
        this._setCollapsibleStateOnAll(folder, vs.TreeItemCollapsibleState.Expanded)
      ),
      vs.commands.registerCommand('githd.viewFileHistoryFromTree', (fileItem: CommittedFileItem) =>
        model.setHistoryViewContext(
          this._context
            ? {
                repo: this._context.repo,
                specifiedPath: fileItem.file.fileUri,
                branch: ''
              }
            : undefined
        )
      ),
      vs.commands.registerCommand('githd.viewFolderHistoryFromTree', (folder: FolderItem) =>
        model.setHistoryViewContext(
          this._context
            ? {
                repo: this._context.repo,
                specifiedPath: vs.Uri.file(path.join(this._context.repo.root, folder.gitRelativePath)),
                branch: ''
              }
            : undefined
        )
      ),
      this._onDidChange
    );

    model.onDidChangeFilesViewContext(
      context => {
        this._context = context;
        this._update();
      },
      null,
      context.subscriptions
    );

    this._context = model.filesViewContext;
    this._withFolder = model.configuration.withFolder;
    this._update();
  }

  readonly onDidChangeTreeData: vs.Event<CommittedTreeItem | undefined> = this._onDidChange.event;

  getTreeItem(element: CommittedTreeItem): CommittedTreeItem {
    return element;
  }

  getChildren(element?: CommittedTreeItem): CommittedTreeItem[] {
    if (!element) {
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

  private get commitOrStashString(): string {
    return this._context?.isStash ? 'Stash' : 'Commit';
  }

  private async _update(): Promise<void> {
    this._treeRoot = [];
    if (!this._context) {
      return;
    }

    const leftRef = this._context.leftRef;
    const rightRef = this._context.rightRef;
    const specifiedPath = this._context.specifiedPath;
    const lineInfo = this._context.focusedLineInfo;

    if (!rightRef) {
      this._onDidChange.fire(undefined);
      return;
    }

    const committedFiles: GitCommittedFile[] = await this._gitService.getCommittedFiles(
      this._context.repo,
      rightRef,
      leftRef,
      this._context.isStash
    );
    if (!leftRef) {
      await this._buildCommitInfo(rightRef);
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
    this._onDidChange.fire(undefined);
  }

  private async _buildCommitInfo(ref: string): Promise<void> {
    await this._treeRoot.push(
      new InfoItem(
        await this._gitService.getCommitDetails(this._context?.repo, ref, this._context?.isStash),
        `${this.commitOrStashString} Info`
      )
    );
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
    let folder = new FolderItem(undefined, '', label, rootFolderIcon);
    buildFileTree(folder, committedFiles, this._withFolder);
    this._treeRoot.push(folder);
  }

  private async _buildFocusFolder(
    label: string,
    committedFiles: GitCommittedFile[],
    specifiedPath: vs.Uri,
    lineInfo?: string
  ): Promise<void> {
    let folder = new FolderItem(undefined, '', label, rootFolderIcon);
    const relativePath = await this._gitService.getGitRelativePath(specifiedPath);
    if (fs.lstatSync(specifiedPath.fsPath).isFile()) {
      if (lineInfo) {
        folder.infoItem = new InfoItem(lineInfo, 'line diff');
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

  private _showFilesWithFolder(parent: FolderItem) {
    if (!parent) {
      this._withFolder = true;
      this._update();
    } else {
      buildFilesWithFolder(parent);
      this._onDidChange.fire(parent);
    }
  }

  private _showFilesWithoutFolder(parent: FolderItem) {
    if (!parent) {
      this._withFolder = false;
      this._update();
    } else {
      parent.subFolders.forEach(folder => buildFilesWithoutFolder(parent, folder));
      parent.subFolders = [];
      this._onDidChange.fire(parent);
    }
  }

  private _setCollapsibleStateOnAll(folder: FolderItem, state: vs.TreeItemCollapsibleState) {
    let parent: FolderItem | undefined;
    if (!folder) {
      this._treeRoot.forEach(sub => {
        if (sub instanceof FolderItem) {
          setCollapsibleStateOnAll(sub, state);
        }
      });
    } else {
      parent = folder.parent;
      folder.collapsibleState = state;
      folder.subFolders.forEach(sub => setCollapsibleStateOnAll(sub, state));
    }

    // HACK: workaround of vscode regression.
    // seems vscode people are planing to add new API https://github.com/Microsoft/vscode/issues/55879
    if (parent) {
      const temp = parent.subFolders;
      parent.subFolders = [];
      this._onDidChange.fire(parent);
      setTimeout(() => {
        if (parent) {
          parent.subFolders = temp;
          this._onDidChange.fire(parent);
        }
      }, 250);
    } else {
      const root = this._treeRoot;
      this._treeRoot = [];
      this._onDidChange.fire(undefined);
      setTimeout(() => {
        this._treeRoot = root;
        this._onDidChange.fire(undefined);
      }, 250);
    }
  }
}
