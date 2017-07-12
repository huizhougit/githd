'use strict'

import { TreeDataProvider, TreeItem, TreeItemCollapsibleState, Uri, window, Event, EventEmitter,
    Disposable, commands } from 'vscode';
import { git } from './git';
import { FileProvider } from './model'
import { Icons } from './icons';
import path = require('path');

class CommittedFile extends TreeItem implements git.CommittedFile {
    readonly uri: Uri = this._uri;
    readonly relativePath: string = this._relativePath;
    readonly status: string = this._status;

    constructor(private _uri: Uri, private _relativePath: string, private _status: string, label?: string) {
        super(label ? label : `${path.basename(_relativePath)} @${path.dirname(_relativePath)}`);
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
    private _disposable: Disposable[] = [];
    private _onDidChange: EventEmitter<CommittedTreeItem> = new EventEmitter<CommittedTreeItem>();
    private _ref: string;

    private _files: CommittedFile[];
    private _fileRoot: FolderItem; // Not in use.

    readonly onDidChangeTreeData: Event<CommittedTreeItem> = this._onDidChange.event;
    get ref(): string { return this._ref; }
    set useTreeView(value: boolean) {
        if (this._treeView !== value) {
            this._treeView = value;
            this.update(this._ref);
        }
    }

    constructor(private _treeView: boolean = false) {
        this._disposable.push(window.registerTreeDataProvider('committedFiles', this));
        this._disposable.push(this._onDidChange);
    }

    clear(): void {
        this.update(null);
    }

    dispose(): void {
        this._disposable.forEach(d => d.dispose());
    }

    getTreeItem(element: CommittedTreeItem): CommittedTreeItem {
        return element;
    }

    getChildren(element?: CommittedTreeItem): CommittedTreeItem[] {
        if (!this._treeView) {
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