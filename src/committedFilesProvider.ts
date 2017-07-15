'use strict'

import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, Event, EventEmitter,
    Disposable, commands, StatusBarItem } from 'vscode';
import { git } from './git';
import { FileProvider } from './model'
import { Icons } from './icons';
import path = require('path');

class CommittedFile extends TreeItem implements git.CommittedFile {
    readonly uri: Uri = this._uri;
    readonly relativePath: string = this._relativePath;
    readonly status: string = this._status;

    constructor(private _uri: Uri, private _relativePath: string, private _status: string, label?: string) {
        super(label ? label : `${path.basename(_relativePath)} \u00a0\u2022\u00a0 ${path.dirname(_relativePath)}`);
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

export class CommittedFilesProvider implements TreeDataProvider<CommittedTreeItem>, FileProvider {
    private _disposables: Disposable[] = [];
    private _onDidChange: EventEmitter<CommittedTreeItem> = new EventEmitter<CommittedTreeItem>();
    private _statusBarItem: StatusBarItem = window.createStatusBarItem(undefined, 1);

    private _ref: string;
    private _files: CommittedFile[];
    private _fileRoot: FolderItem; // Not in use.

    readonly onDidChangeTreeData: Event<CommittedTreeItem> = this._onDidChange.event;
    get ref(): string { return this._ref; }
    set withFolder(value: boolean) {
        if (this._withFolder !== value) {
            this._withFolder = value;
            this._statusBarItem.text = 'githd: ' + (this._withFolder ? 'folder' : 'nofolder');
            this.update(this._ref);
        }
    }

    constructor(private _withFolder: boolean = false) {
        this._disposables.push(window.registerTreeDataProvider('committedFiles', this));
        this._disposables.push(this._onDidChange);

        this._statusBarItem.text = 'githd: ' + (this._withFolder ? 'folder' : 'nofolder');
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
        if (!this._withFolder) {
            return this._files;
        }

        if (!element) {
            element = this._fileRoot;
        }
        let folder = element as FolderItem;
        if (folder) {
            return [].concat(folder.subFolders, folder.files);
        }
        return [];
    }

    async update(ref: string): Promise<void> {
        if (ref) {
            this._ref = ref;
            const files: git.CommittedFile[] = await git.getCommittedFiles(ref);
            this._files = files.map(file => {
                return new CommittedFile(file.uri, file.relativePath, file.status);
            });
            this._fileRoot = new FolderItem('');
            files.forEach(file => this._buildFileTree(file));
        } else {
            this._files = [];
            this._fileRoot = null;
        }
        this._onDidChange.fire();
    }

    _buildFileTree(file: git.CommittedFile): void {
        let segments: string[] = file.relativePath.split('/');
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
        parent.files.push(new CommittedFile(file.uri, file.relativePath, file.status, segments[i]));
    }
}