'use strict'

import * as path from 'path';
import * as fs from 'fs';

import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, Event, EventEmitter,
    Disposable, commands, StatusBarItem } from 'vscode';
import { git } from './git';
import { FileProvider } from './model'
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
    get files(): CommittedFile[] { return this._files; }

    constructor(label: string, iconPath?: { light: string | Uri; dark: string | Uri }) {
        super(label);
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

function buildFileTree(rootFolder: FolderItem, files: git.CommittedFile[], withFolder: boolean): void {
    if (withFolder) {
        files.forEach(file => {
            let segments: string[] = file.gitRelativePath.split('/');
            let parent: FolderItem = rootFolder;
            let i = 0;
            for (; i < segments.length - 1; ++i) {
                let folder: FolderItem = parent.subFolders.find(item => { return item.label === segments[i]; });
                if (!folder) {
                    folder = new FolderItem(segments[i]);
                    parent.subFolders.push(folder);
                }
                parent = folder;
            }
            parent.files.push(new CommittedFile(file.uri, file.gitRelativePath, file.status, segments[i]));
        });
    } else {
        rootFolder.files.push(...(files.map(file => { return createCommittedFile(file); })));
    }
}

function buildCommitFolder(label: string, committedFiles: git.CommittedFile[], withFolder: boolean): FolderItem {
    let folder = new FolderItem(label, rootFolderIcon);
    buildFileTree(folder, committedFiles, withFolder);
    return folder;
}

async function buildFocusFolder(label: string, specifiedPath: Uri, committedFiles: git.CommittedFile[], withFolder: boolean): Promise<FolderItem> {
    let folder = new FolderItem(label, rootFolderIcon);
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

export class ExplorerViewProvider implements TreeDataProvider<CommittedTreeItem>, FileProvider {
    private _disposables: Disposable[] = [];
    private _onDidChange: EventEmitter<CommittedTreeItem> = new EventEmitter<CommittedTreeItem>();
    private _statusBarItem: StatusBarItem = window.createStatusBarItem(undefined, 1);

    private _leftRef: string;
    private _rightRef: string;
    private _rootFolder: CommittedTreeItem[] = [];
    private _specifiedPath: Uri;

    constructor(private _withFolder: boolean = false) {
        this._disposables.push(window.registerTreeDataProvider('committedFiles', this));
        this._disposables.push(this._onDidChange);

        this._statusBarItem.text = this._getStatusBarItemText();
        this._statusBarItem.command = 'githd.setExplorerViewWithFolder';
        this._statusBarItem.tooltip = 'Set if the committed files show with folder or not';
        this._statusBarItem.show();
        this._disposables.push(this._statusBarItem);
    }

    readonly onDidChangeTreeData: Event<CommittedTreeItem> = this._onDidChange.event;
    set withFolder(value: boolean) {
        if (this._withFolder !== value) {
            this._withFolder = value;
            this._statusBarItem.text = this._getStatusBarItemText();
            this.update(this._leftRef, this._rightRef, this._specifiedPath);
        }
    }
    get leftRef(): string { return this._leftRef; }
    get rightRef(): string { return this._rightRef; }

    clear(): void {
        this.update(null, null);
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

    async update(leftRef: string, rightRef: string, specifiedPath?: Uri): Promise<void> {
        this._specifiedPath = specifiedPath;
        this._rootFolder = [];
        this._leftRef = leftRef;
        this._rightRef = rightRef;

        if (!rightRef) {
            this._onDidChange.fire();
            return;
        }

        const committedFiles: git.CommittedFile[] = await git.getCommittedFiles(leftRef, rightRef);
        if (!leftRef && !specifiedPath) {
            this._buildCommitTree(committedFiles);
        } else if (leftRef && !specifiedPath) {
            this._buildDiffBranchTree(committedFiles);
        } else if (!leftRef && specifiedPath) {
            this._buildPathSpecifiedCommitTree(specifiedPath, committedFiles);
        } else {
            this._buildPathSpecifiedDiffBranchTree(specifiedPath, committedFiles);
        }
        this._onDidChange.fire();
    }

    private _buildCommitTree(committedFiles: git.CommittedFile[]): void {
        this._rootFolder.push(buildCommitFolder(`Changes of Commit ${this._rightRef}`, committedFiles, this._withFolder));
    }

    private _buildDiffBranchTree(committedFiles: git.CommittedFile[]): void {
        this._rootFolder.push(buildCommitFolder(`Diffs between ${this._leftRef} and ${this._rightRef}`, committedFiles, this._withFolder));
    }

    private async _buildPathSpecifiedCommitTree(specifiedPath: Uri, committedFiles: git.CommittedFile[]): Promise<void> {
        this._rootFolder.push(await buildFocusFolder('Focus', specifiedPath, committedFiles, this._withFolder));
        this._rootFolder.push(buildCommitFolder(`Changes of Commit ${this._rightRef}`, committedFiles, this._withFolder));
    }

    private async _buildPathSpecifiedDiffBranchTree(specifiedPath: Uri, committedFiles: git.CommittedFile[]): Promise<void> {
        this._rootFolder.push(await buildFocusFolder(`${this._leftRef} .. ${this._rightRef}`, specifiedPath, committedFiles, this._withFolder));
    }

    private _getStatusBarItemText(): string {
        return this._statusBarItem.text = 'githd:  ' + (this._withFolder ? `$(file-directory)` : `$(list-unordered)`);
    }
}