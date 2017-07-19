'use strict'

import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, Event, EventEmitter,
    Disposable, commands, StatusBarItem } from 'vscode';
import { git } from './git';
import { FileProvider } from './model'
import { Icons, getIconUri } from './icons';
import path = require('path');

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
        this.iconPath = { light: this._getIconPath('light'), dark: this._getIconPath('dark') };
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

    constructor(label: string) {
        super(label);
        this.collapsibleState = TreeItemCollapsibleState.Expanded;
    }
}

type CommittedTreeItem = CommittedFile | FolderItem;

export class ExplorerViewProvider implements TreeDataProvider<CommittedTreeItem>, FileProvider {
    private _disposables: Disposable[] = [];
    private _onDidChange: EventEmitter<CommittedTreeItem> = new EventEmitter<CommittedTreeItem>();
    private _statusBarItem: StatusBarItem = window.createStatusBarItem(undefined, 1);

    private _ref: string;
    private _files: CommittedFile[] = []; // for no folder view
    private _fileRoot: FolderItem; // for folder view
    private _specifiedFile: CommittedFile;

    readonly onDidChangeTreeData: Event<CommittedTreeItem> = this._onDidChange.event;
    get ref(): string { return this._ref; }
    set withFolder(value: boolean) {
        if (this._withFolder !== value) {
            this._withFolder = value;
            this._statusBarItem.text = this._getStatusBarItemText();
            this.update(this._ref, this._specifiedFile ? this._specifiedFile.uri : undefined);
        }
    }

    constructor(private _withFolder: boolean = false) {
        this._disposables.push(window.registerTreeDataProvider('committedFiles', this));
        this._disposables.push(this._onDidChange);

        this._statusBarItem.text = this._getStatusBarItemText();
        this._statusBarItem.command = 'githd.setExplorerViewWithFolder';
        this._statusBarItem.tooltip = 'Set if the committed files show with folder or not';
        this._statusBarItem.show();
        this._disposables.push(this._statusBarItem);
    }

    clear(): void {
        this.update(null);
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    getTreeItem(element: CommittedTreeItem): CommittedTreeItem {
        return element;
    }

    getChildren(element?: CommittedTreeItem): CommittedTreeItem[] {
        if (!this._ref) {
            return [];
        }

        if (!element) {
            element = new FolderItem('');

            if (this._specifiedFile) {
                let focus = new FolderItem('Focus');
                focus.iconPath = rootFolderIcon;
                focus.files.push(this._specifiedFile);
                element.subFolders.push(focus);
            }
            let commit = new FolderItem('Changes of Commit ' + this._ref);
            commit.iconPath = rootFolderIcon;
            if (!this._withFolder) {
                commit.files.push(...this._files);
            } else {
                commit.subFolders.push(...this._fileRoot.subFolders);
                commit.files.push(...this._fileRoot.files);
            }
            element.subFolders.push(commit);
        }

        let folder = element as FolderItem;
        if (folder) {
            return [].concat(folder.subFolders, folder.files);
        }
        return [];
    }

    async update(ref: string, specifiedFile?: Uri): Promise<void> {
        this._specifiedFile = undefined;
        this._ref = ref;
        if (ref) {
            const files: git.CommittedFile[] = await git.getCommittedFiles(ref);
            this._files = files.map(file => {
                const label: string = this._getFormatedLabel(file.gitRelativePath);
                if (specifiedFile && specifiedFile.path === file.uri.path) {
                    this._specifiedFile = new CommittedFile(file.uri, file.gitRelativePath, file.status, label);
                }
                return new CommittedFile(file.uri, file.gitRelativePath, file.status, label);
            });
            this._fileRoot = new FolderItem('');
            files.forEach(file => this._buildFileTree(file));
        } else {
            this._files = [];
            this._fileRoot = null;
        }
        this._onDidChange.fire();
    }

    private _getFormatedLabel(relativePath: string): string {
        const name: string = path.basename(relativePath);
        let dir: string = path.dirname(relativePath);
        if (dir === '.') {
            dir = '';
        }
        return name + ' \u00a0\u2022\u00a0 ' + dir;
    }

    private _buildFileTree(file: git.CommittedFile): void {
        let segments: string[] = file.gitRelativePath.split('/');
        let parent: FolderItem = this._fileRoot;
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
    }

    private _getStatusBarItemText(): string {
        return this._statusBarItem.text = 'githd: ' + (this._withFolder ? 'folder' : 'witout folder');
    }
}