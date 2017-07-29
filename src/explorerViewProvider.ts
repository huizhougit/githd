'use strict'

import * as path from 'path';
import * as fs from 'fs';

import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, Event, EventEmitter,
    Disposable, commands, StatusBarItem } from 'vscode';
import { git } from './git';
import { Model, FilesViewContext } from './model'
import { Icons, getIconUri } from './icons';

const rootFolderIcon = {
    dark: getIconUri('structure', 'dark'),
    light: getIconUri('structure', 'light')
};

class CommittedFile extends TreeItem implements git.CommittedFile {
    readonly uri: Uri = this._uri;
    readonly gitRelativePath: string = this._gitRelativePath;
    readonly status: string = this._status;

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

    get subFolders(): FolderItem[] { return this._subFolders; }
    set subFolders(value: FolderItem[]) { this._subFolders = value; }
    get files(): CommittedFile[] { return this._files; }
    set files(value: CommittedFile[]) { this._files = value; }
    get gitRelativePath(): string { return this._gitRelativePath; }

    constructor(private _gitRelativePath: string, label: string, iconPath?: { light: string | Uri; dark: string | Uri }) {
        super(label);
        this.contextValue = 'folder';
        this.iconPath = iconPath;
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
    }
}

type CommittedTreeItem = CommittedFile | FolderItem;

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
            folder = new FolderItem(gitRelativePath, segments[i]);
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

function buildCommitFolder(label: string, committedFiles: git.CommittedFile[], withFolder: boolean): FolderItem {
    let folder = new FolderItem("", label, rootFolderIcon);
    buildFileTree(folder, committedFiles, withFolder);
    return folder;
}

async function buildFocusFolder(label: string, specifiedPath: Uri, committedFiles: git.CommittedFile[], withFolder: boolean): Promise<FolderItem> {
    let folder = new FolderItem("", label, rootFolderIcon);
    const relativePath = await git.getGitRelativePath(specifiedPath);
    if (fs.lstatSync(specifiedPath.fsPath).isFile()) {
        let file = committedFiles.find(value => { return value.uri.fsPath === specifiedPath.fsPath; });
        let focus = new CommittedFile(specifiedPath, relativePath, file ? file.status : null,
            getFormatedLabel(relativePath));
        folder.files.push(focus);
    } else {
        let focus: git.CommittedFile[] = [];
        committedFiles.forEach(file => {
            if (file.gitRelativePath.search(relativePath) === 0) {
                focus.push(createCommittedFile(file));
            }
        });
        buildFileTree(folder, focus, withFolder);
    }
    return folder;
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

export class ExplorerViewProvider implements TreeDataProvider<CommittedTreeItem> {
    private _disposables: Disposable[] = [];
    private _onDidChange: EventEmitter<CommittedTreeItem> = new EventEmitter<CommittedTreeItem>();
    private _statusBarItem: StatusBarItem = window.createStatusBarItem(undefined, 1);
    private _withFolder: boolean;

    private _leftRef: string;
    private _rightRef: string;
    private _specifiedPath: Uri;
    private _rootFolder: CommittedTreeItem[] = [];

    constructor(model: Model) {
        this._disposables.push(window.registerTreeDataProvider('committedFiles', this));
        this._disposables.push(commands.registerCommand('githd.showFilesWithFolder',
            (folder: FolderItem) => this._showFilesWithFolder(folder)));
        this._disposables.push(commands.registerCommand('githd.showFilesWithoutFolder',
            (folder: FolderItem) => this._showFilesWithoutFolder(folder)));
        this._disposables.push(this._onDidChange);

        model.onDidChangeFilesViewContext(context => this._update(context), null, this._disposables);
        model.onDidChangeConfiguration(config => {
            if (config.withFolder !== this._withFolder) {
                this.withFolder = config.withFolder;
                this._update(model.filesViewContext);
            }
        }, null, this._disposables);
        this._withFolder = model.configuration.withFolder;
        this._update(model.filesViewContext);

        this._statusBarItem.text = this._getStatusBarItemText();
        this._statusBarItem.command = 'githd.setExplorerViewWithFolder';
        this._statusBarItem.tooltip = 'Set if the committed files show with folder or not';
        this._statusBarItem.hide();
        this._disposables.push(this._statusBarItem);
    }

    readonly onDidChangeTreeData: Event<CommittedTreeItem> = this._onDidChange.event;
    private set withFolder(value: boolean) {
        this._withFolder = value;
        this._statusBarItem.text = this._getStatusBarItemText();
    }

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
            return [].concat(folder.subFolders, folder.files);
        }
        return [];
    }

    private async _update(context: FilesViewContext): Promise<void> {
        this._rootFolder = [];
        if (!context.rightRef) {
            this._statusBarItem.hide();
            this._onDidChange.fire();
            return;
        }

        let leftRef: string = context.leftRef;
        let rightRef: string = context.rightRef;
        let specifiedPath: Uri = context.specifiedPath;
        const committedFiles: git.CommittedFile[] = await git.getCommittedFiles(leftRef, rightRef);
        if (!leftRef && !specifiedPath) {
            this._buildCommitTree(committedFiles, rightRef, this._withFolder);
        } else if (leftRef && !specifiedPath) {
            this._buildDiffBranchTree(committedFiles, leftRef, rightRef, this._withFolder);
        } else if (!leftRef && specifiedPath) {
            this._buildPathSpecifiedCommitTree(committedFiles, specifiedPath, rightRef, this._withFolder);
        } else {
            this._buildPathSpecifiedDiffBranchTree(committedFiles, context, this._withFolder);
        }
        this._statusBarItem.show();
        this._onDidChange.fire();
    }

    private _buildCommitTree(files: git.CommittedFile[], ref: string, withFolder: boolean): void {
        this._rootFolder.push(buildCommitFolder(`Changes of Commit ${ref}`, files, withFolder));
    }

    private _buildDiffBranchTree(files: git.CommittedFile[], leftRef: string, rightRef: string, withFolder: boolean): void {
        this._rootFolder.push(buildCommitFolder(`Diffs between ${leftRef} and ${rightRef}`, files, withFolder));
    }

    private async _buildPathSpecifiedCommitTree(files: git.CommittedFile[], specifiedPath: Uri, ref: string, withFolder: boolean): Promise<void> {
        this._rootFolder.push(await buildFocusFolder('Focus', specifiedPath, files, withFolder));
        this._rootFolder.push(buildCommitFolder(`Changes of Commit ${ref}`, files, withFolder));
    }

    private async _buildPathSpecifiedDiffBranchTree(files: git.CommittedFile[], context: FilesViewContext, withFolder: boolean): Promise<void> {
        this._rootFolder.push(await buildFocusFolder(`${context.leftRef} .. ${context.rightRef}`, context.specifiedPath, files, withFolder));
    }

    private _getStatusBarItemText(): string {
        return this._statusBarItem.text = 'githd:  ' + (this._withFolder ? `$(file-directory)` : `$(list-unordered)`);
    }

    private _showFilesWithFolder(parent: FolderItem): void {
        buildFilesWithFolder(parent);
        this._onDidChange.fire(parent);
    }

    private _showFilesWithoutFolder(parent: FolderItem): void {
        parent.subFolders.forEach(folder => buildFilesWithoutFolder(parent, folder));
        parent.subFolders = [];
        this._onDidChange.fire(parent);
    }
}