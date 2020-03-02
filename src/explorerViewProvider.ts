'use strict'

import * as path from 'path';
import * as fs from 'fs';

import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, Event, EventEmitter,
    Disposable, commands, TreeView } from 'vscode';
import { GitService, GitCommittedFile } from './gitService';
import { Model, FilesViewContext } from './model'
import { Icons, getIconUri } from './icons';

const rootFolderIcon = {
    dark: getIconUri('structure', 'dark'),
    light: getIconUri('structure', 'light')
};

class InfoItem extends TreeItem {
    constructor(content: string, label: string) {
        super(label);
        this.command = {
            title: '',
            command: 'githd.openCommitInfo',
            arguments: [content]
        };
        this.iconPath = getIconUri('info', '');
    };

    readonly parent =  null;
}

class CommittedFile extends TreeItem implements GitCommittedFile {
    constructor(private _parent: FolderItem, private _uri: Uri, private _gitRelativePath: string, private _status: string, label: string) {
        super(label);
        this.command = {
            title: '',
            command: 'githd.openCommittedFile',
            arguments: [this]
        };
        if (this._status) {
            this.iconPath = { light: this._getIconPath('light'), dark: this._getIconPath('dark') };
        }
    };

    readonly parent =  this._parent;
    readonly uri: Uri = this._uri;
    readonly gitRelativePath: string = this._gitRelativePath;
    readonly status: string = this._status;

    private _getIconPath(theme: string): Uri | undefined {
        switch (this._status[0].toUpperCase()) {
            case 'M': return Icons[theme].Modified;
            case 'A': return Icons[theme].Added;
            case 'D': return Icons[theme].Deleted;
            case 'R': return Icons[theme].Renamed;
            case 'C': return Icons[theme].Copied;
            default: return void 0;
        }
    }
}

class FolderItem extends TreeItem {
    private _subFolders: FolderItem[] = [];
    private _files: CommittedFile[] = [];
    private _infoItem: InfoItem;

    constructor(private _parent: FolderItem, private _gitRelativePath: string, label: string, iconPath?: { light: Uri; dark: Uri }) {
        super(label);
        this.contextValue = 'folder';
        this.iconPath = iconPath;
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
    }

    readonly parent =  this._parent;
    readonly gitRelativePath: string = this._gitRelativePath;
    get subFolders(): FolderItem[] { return this._subFolders; }
    set subFolders(value: FolderItem[]) { this._subFolders = value; }
    get files(): CommittedFile[] { return this._files; }
    set files(value: CommittedFile[]) { this._files = value; }
    get infoItem(): InfoItem { return this._infoItem; }
    set infoItem(value: InfoItem) { this._infoItem = value; }
}

function getFormattedLabel(relativePath: string): string {
    const name: string = path.basename(relativePath);
    let dir: string = path.dirname(relativePath);
    if (dir === '.') {
        dir = '';
    }
    return name + ' \u00a0\u2022\u00a0 ' + dir;
}

function createCommittedFile(rootFolder: FolderItem, file: GitCommittedFile): CommittedFile {
    return new CommittedFile(rootFolder, file.uri, file.gitRelativePath, file.status, getFormattedLabel(file.gitRelativePath));
}

function buildOneFileWithFolder(rootFolder: FolderItem, file: GitCommittedFile, relativePath: string = ''): void {
    const segments: string[] = relativePath ? path.relative(relativePath, file.gitRelativePath).split(/\\|\//) :
        file.gitRelativePath.split('/');
    let gitRelativePath: string = relativePath;
    let parent: FolderItem = rootFolder;
    let i = 0;
    for (; i < segments.length - 1; ++i) {
        gitRelativePath += segments[i] + '/';
        let folder: FolderItem = parent.subFolders.find(item => { return item.label === segments[i]; });
        if (!folder) {
            folder = new FolderItem(parent, gitRelativePath, segments[i]);
            parent.subFolders.push(folder);
        }
        parent = folder;
    }
    parent.files.push(new CommittedFile(parent, file.uri, file.gitRelativePath, file.status, segments[i]));
}

function buildFileTree(rootFolder: FolderItem, files: GitCommittedFile[], withFolder: boolean): void {
    if (withFolder) {
        files.forEach(file => buildOneFileWithFolder(rootFolder, file));
    } else {
        rootFolder.files.push(...(files.map(file => { return createCommittedFile(rootFolder, file); })));
    }
}

function buildFilesWithoutFolder(rootFolder: FolderItem, folder: FolderItem): void {
    rootFolder.files.push(...(folder.files.map(file => {
        file.label = getFormattedLabel(path.relative(rootFolder.gitRelativePath, file.gitRelativePath).replace(/\\/g, '/'));
        return file;
    })));
    folder.subFolders.forEach(f => buildFilesWithoutFolder(rootFolder, f));
    folder.files = [];
    folder.subFolders = [];
}

function buildFilesWithFolder(rootFolder: FolderItem): void {
    rootFolder.subFolders.forEach(folder => buildFilesWithFolder(folder));
    const files: CommittedFile[] = rootFolder.files;
    rootFolder.files = [];
    files.forEach(file => buildOneFileWithFolder(rootFolder, file, rootFolder.gitRelativePath));
}

function setCollapsibleStateOnAll(rootFolder: FolderItem, state: TreeItemCollapsibleState): void {
    if (rootFolder) {
        rootFolder.collapsibleState = state;
        rootFolder.subFolders.forEach(sub => setCollapsibleStateOnAll(sub, state));
    }
}

type CommittedTreeItem = CommittedFile | FolderItem | InfoItem;

export class ExplorerViewProvider implements TreeDataProvider<CommittedTreeItem> {
    private _disposables: Disposable[] = [];
    private _onDidChange: EventEmitter<CommittedTreeItem> = new EventEmitter<CommittedTreeItem>();
    private _withFolder: boolean;

    private _context: FilesViewContext;
    private _treeRoot: (FolderItem | InfoItem)[] = [];

    constructor(model: Model, private _gitService: GitService) {
        this._disposables.push(window.registerTreeDataProvider('committedFiles', this));
        this._disposables.push(commands.registerCommand('githd.showFilesWithFolder',
            (folder: FolderItem) => this._showFilesWithFolder(folder)));
        this._disposables.push(commands.registerCommand('githd.showFilesWithoutFolder',
            (folder: FolderItem) => this._showFilesWithoutFolder(folder)));
        this._disposables.push(commands.registerCommand('githd.collapseFolder',
            (folder: FolderItem) => this._setCollapsibleStateOnAll(folder, TreeItemCollapsibleState.Collapsed)));
        this._disposables.push(commands.registerCommand('githd.expandFolder',
            (folder: FolderItem) => this._setCollapsibleStateOnAll(folder, TreeItemCollapsibleState.Expanded)));
        this._disposables.push(commands.registerCommand('githd.viewFileHistoryFromTree',
            (file: CommittedFile) => model.setHistoryViewContext({ repo: this._context.repo, specifiedPath: file.uri })));
        this._disposables.push(commands.registerCommand('githd.viewFolderHistoryFromTree',
            (folder: FolderItem) => model.setHistoryViewContext({
                repo: this._context.repo,
                specifiedPath: Uri.file(path.join(this._context.repo.root, folder.gitRelativePath))
            })));

        this._disposables.push(this._onDidChange);

        model.onDidChangeFilesViewContext(context => {
            this._context = context;
            this._update();
         }, null, this._disposables);

        this._context = model.filesViewContext;
        this._withFolder = model.configuration.withFolder;
        this._update();
    }

    readonly onDidChangeTreeData: Event<CommittedTreeItem> = this._onDidChange.event;

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    getTreeItem(element: CommittedTreeItem): CommittedTreeItem {
        return element;
    }

    getChildren(element?: CommittedTreeItem): CommittedTreeItem[] {
        if (!element) {
            return this._treeRoot;
        }
        let folder = element as FolderItem;
        if (folder) {
            return [].concat(folder.subFolders, folder.infoItem, folder.files);
        }
        return [];
    }

    getParent(element: CommittedTreeItem): CommittedTreeItem {
        return element.parent;
    }

    private get commitOrStashString(): string {
        return this._context.isStash ? 'Stash' : 'Commit';
    }

    private async _update(): Promise<void> {
        this._treeRoot = [];
        if (!this._context) {
            return;
        }

        const leftRef: string = this._context.leftRef;
        const rightRef: string = this._context.rightRef;
        const specifiedPath: Uri = this._context.specifiedPath;
        const lineInfo: string = this._context.focusedLineInfo;

        if (!rightRef) {
            this._onDidChange.fire();
            return;
        }

        const committedFiles: GitCommittedFile[] = await this._gitService.getCommittedFiles(this._context.repo, leftRef, rightRef, this._context.isStash);
        if (!leftRef) {
            await this._buildCommitInfo(rightRef);
        }
        if (!leftRef && !specifiedPath) {
            this._buildCommitTree(committedFiles, rightRef);
        } else if (leftRef && !specifiedPath) {
            this._buildDiffBranchTree(committedFiles, leftRef, rightRef);
        } else if (!leftRef && specifiedPath) {
            await this._buildPathSpecifiedCommitTree(committedFiles, specifiedPath, lineInfo, rightRef);
        } else {
            await this._buildPathSpecifiedDiffBranchTree(committedFiles, this._context);
        }
        this._onDidChange.fire();
    }

    private async _buildCommitInfo(ref: string): Promise<void> {
        await this._treeRoot.push(new InfoItem(await this._gitService.getCommitDetails(this._context.repo, ref, this._context.isStash),
            `${this.commitOrStashString} Info`));
    }

    private _buildCommitTree(files: GitCommittedFile[], ref: string): void {
        this._buildCommitFolder(`${this.commitOrStashString} ${ref} \u00a0 (${files.length} files changed)`, files);
    }

    private _buildDiffBranchTree(files: GitCommittedFile[], leftRef: string, rightRef): void {
        this._buildCommitFolder(`Diffs between ${leftRef} and ${rightRef} \u00a0 (${files.length} files)`, files);
    }

    private async _buildPathSpecifiedCommitTree(files: GitCommittedFile[], specifiedPath: Uri, lineInfo:string, ref: string): Promise<void> {
        await this._buildFocusFolder('Focus', files, specifiedPath, lineInfo);
        this._buildCommitTree(files, ref);
    }

    private async _buildPathSpecifiedDiffBranchTree(files: GitCommittedFile[], context: FilesViewContext): Promise<void> {
        await this._buildFocusFolder(`${context.leftRef} .. ${context.rightRef}`, files, context.specifiedPath);
    }

    private _buildCommitFolder(label: string, committedFiles: GitCommittedFile[]): void {
        let folder = new FolderItem(null, '', label, rootFolderIcon);
        buildFileTree(folder, committedFiles, this._withFolder);
        this._treeRoot.push(folder);
    }

    private async _buildFocusFolder(label: string, committedFiles: GitCommittedFile[], specifiedPath: Uri, lineInfo?: string): Promise<void> {
        let folder = new FolderItem(null, '', label, rootFolderIcon);
        const relativePath = await this._gitService.getGitRelativePath(specifiedPath);
        if (fs.lstatSync(specifiedPath.fsPath).isFile()) {
            if (lineInfo) {
                folder.infoItem = new InfoItem(lineInfo, 'line diff');
            }
            let file = committedFiles.find(value => { return value.gitRelativePath === relativePath; });
            if (file) {
                folder.files.push(createCommittedFile(folder, file));
            }
        } else {
            let focus: GitCommittedFile[] = [];
            committedFiles.forEach(file => {
                if (file.gitRelativePath.search(relativePath) === 0) {
                    focus.push(file);
                }
            });
            buildFileTree(folder, focus, this._withFolder);
        }
        if (folder.files.length + folder.subFolders.length > 0 || folder.infoItem) {
            this._treeRoot.push(folder);
        }
    }

    private _showFilesWithFolder(parent: FolderItem): void {
        if (!parent) {
            this._withFolder = true;
            this._update();
        } else {
            buildFilesWithFolder(parent);
            this._onDidChange.fire(parent);
        }
    }

    private _showFilesWithoutFolder(parent: FolderItem): void {
        if (!parent) {
            this._withFolder = false;
            this._update();
        } else {
            parent.subFolders.forEach(folder => buildFilesWithoutFolder(parent, folder));
            parent.subFolders = [];
            this._onDidChange.fire(parent);
        }
    }

    private _setCollapsibleStateOnAll(folder: FolderItem, state: TreeItemCollapsibleState): void {
        let parent: FolderItem;
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
                parent.subFolders = temp;
                this._onDidChange.fire(parent);
            }, 250);
        } else {
            const root = this._treeRoot;
            this._treeRoot = null;
            this._onDidChange.fire();
            setTimeout(() => {
                this._treeRoot = root;
                this._onDidChange.fire();
            }, 250);
        }
    }
}
