'use strict'

import * as path from 'path';
import * as fs from 'fs';

import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, Event, EventEmitter,
    Disposable, commands } from 'vscode';
import { git } from './git';
import { Model, FilesViewContext } from './model'
import { Icons, getIconUri } from './icons';

const rootFolderIcon = {
    dark: getIconUri('structure', 'dark'),
    light: getIconUri('structure', 'light')
};

class LineDiffItem extends TreeItem {
    constructor(content: string, label: string) {
        super(label);
        this.command = {
            title: '',
            command: 'githd.openLineDiff',
            arguments: [content]
        };
        this.iconPath = { light: getIconUri('diff', 'light'), dark: getIconUri('diff', 'dark') };
    };
}

class CommittedFile extends TreeItem implements git.CommittedFile {
    constructor(private _uri: Uri, private _gitRelativePath: string, private _status: string, label: string) {
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
    private _lineDiffItem: LineDiffItem;
    
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
    get lineDiffItem(): LineDiffItem { return this._lineDiffItem; }
    set lineDiffItem(value: LineDiffItem) { this._lineDiffItem = value; }
}

function getFormatedLabel(relativePath: string): string {
    const name: string = path.basename(relativePath);
    let dir: string = path.dirname(relativePath);
    if (dir === '.') {
        dir = '';
    }
    return name + ' \u00a0\u2022\u00a0 ' + dir;
}

function createCommittedFile(file: git.CommittedFile): CommittedFile {
    return new CommittedFile(file.uri, file.gitRelativePath, file.status, getFormatedLabel(file.gitRelativePath));
}

function buildOneFileWithFolder(rootFolder: FolderItem, file: git.CommittedFile, relateivePath: string = ''): void {
    const segments: string[] = relateivePath ? path.relative(relateivePath, file.gitRelativePath).split(/\\|\//) :
        file.gitRelativePath.split('/');
    let gitRelativePath: string = relateivePath;
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
    parent.files.push(new CommittedFile(file.uri, file.gitRelativePath, file.status, segments[i]));
}

function buildFileTree(rootFolder: FolderItem, files: git.CommittedFile[], withFolder: boolean): void {
    if (withFolder) {
        files.forEach(file => buildOneFileWithFolder(rootFolder, file));
    } else {
        rootFolder.files.push(...(files.map(file => { return createCommittedFile(file); })));
    }
}

function buildFilesWithoutFolder(rootFolder: FolderItem, folder: FolderItem): void {
    rootFolder.files.push(...(folder.files.map(file => {
        file.label = getFormatedLabel(path.relative(rootFolder.gitRelativePath, file.gitRelativePath).replace(/\\/g, '/'));
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
    rootFolder.collapsibleState = state;
    rootFolder.subFolders.forEach(sub => setCollapsibleStateOnAll(sub, state));
}

type CommittedTreeItem = CommittedFile | FolderItem | LineDiffItem;

export class ExplorerViewProvider implements TreeDataProvider<CommittedTreeItem> {
    private _disposables: Disposable[] = [];
    private _onDidChange: EventEmitter<CommittedTreeItem> = new EventEmitter<CommittedTreeItem>();
    private _withFolder: boolean;

    private _context: FilesViewContext;
    private _rootFolder: FolderItem[] = [];

    constructor(model: Model) {
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
            (file: CommittedFile) => model.setHistoryViewContext({ specifiedPath: file.uri })));
        this._disposables.push(commands.registerCommand('githd.viewFolderHistoryFromTree',
            (folder: FolderItem) => model.setHistoryViewContext({
                specifiedPath: Uri.file(path.join(git.getGitRootPath(), folder.gitRelativePath))
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
            return this._rootFolder;
        }
        let folder = element as FolderItem;
        if (folder) {
            return [].concat(folder.subFolders, folder.lineDiffItem, folder.files);
        }
        return [];
    }

    private async _update(): Promise<void> {
        this._rootFolder = [];
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

        const committedFiles: git.CommittedFile[] = await git.getCommittedFiles(leftRef, rightRef);
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

    private _buildCommitTree(files: git.CommittedFile[], ref: string): void {
        this._buildCommitFolder(`Commit ${ref} \u00a0 (${files.length} files changed)`, files);
    }

    private _buildDiffBranchTree(files: git.CommittedFile[], leftRef: string, rightRef): void {
        this._buildCommitFolder(`Diffs between ${leftRef} and ${rightRef} \u00a0 (${files.length} files)`, files);
    }

    private async _buildPathSpecifiedCommitTree(files: git.CommittedFile[], specifiedPath: Uri, lineInfo:string, ref: string): Promise<void> {
        if (files.findIndex(file => { return file.uri.fsPath === specifiedPath.fsPath; }) >= 0 || lineInfo) {
            if (lineInfo) {
                lineInfo = await git.getCommitDetails(ref) + '\r\n\r\n' + lineInfo;
            }
            await this._buildFocusFolder('Focus', files, specifiedPath, lineInfo);
        }
        this._buildCommitTree(files, ref);
    }

    private async _buildPathSpecifiedDiffBranchTree(files: git.CommittedFile[], context: FilesViewContext): Promise<void> {
        await this._buildFocusFolder(`${context.leftRef} .. ${context.rightRef}`, files, context.specifiedPath);
    }

    private _buildCommitFolder(label: string, committedFiles: git.CommittedFile[]): void {
        let folder = new FolderItem(null, '', label, rootFolderIcon);
        buildFileTree(folder, committedFiles, this._withFolder);
        this._rootFolder.push(folder);
    }

    private async _buildFocusFolder(label: string, committedFiles: git.CommittedFile[], specifiedPath: Uri, lineInfo?: string): Promise<void> {
        let folder = new FolderItem(null, '', label, rootFolderIcon);
        if (lineInfo) {
            folder.lineDiffItem = new LineDiffItem(lineInfo, 'line diff');
        }
        const relativePath = await git.getGitRelativePath(specifiedPath);
        if (fs.lstatSync(specifiedPath.fsPath).isFile()) {
            let file = committedFiles.find(value => { return value.uri.fsPath === specifiedPath.fsPath; });
            if (file) {
                let focus = new CommittedFile(specifiedPath, relativePath, file.status, getFormatedLabel(relativePath));
                folder.files.push(focus);
            }
        } else {
            let focus: git.CommittedFile[] = [];
            committedFiles.forEach(file => {
                if (file.gitRelativePath.search(relativePath) === 0) {
                    focus.push(createCommittedFile(file));
                }
            });
            buildFileTree(folder, focus, this._withFolder);
        }
        this._rootFolder.push(folder);
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
            this._rootFolder.forEach(sub => {
                setCollapsibleStateOnAll(sub, state);
            });
        } else {
            parent = folder.parent;
            folder.collapsibleState = state;
            folder.subFolders.forEach(sub => setCollapsibleStateOnAll(sub, state));
        }
        this._onDidChange.fire(parent);
    }
}