'use strict'

import {
    SourceControlResourceState, SourceControlResourceGroup, scm, SourceControlResourceDecorations,
    Uri, workspace, Disposable, Command, commands
} from 'vscode';
import { git } from './git';
import { Icons } from './icons';
import path = require('path');

function createUri(relativePath: string): Uri {
    const absPath = path.join(workspace.rootPath, relativePath);
    return Uri.file(absPath);
}

export class Resource implements SourceControlResourceState, git.CommittedFile {
    readonly uri: Uri = this._uri;
    readonly relativePath: string = this._relativePath;
    readonly status: string = this._status;
    readonly resourceUri: Uri = this._uri;
    readonly command: Command = { title: '', command: 'githd.openCommittedFile', arguments: [this] };

    constructor(private _uri: Uri, private _relativePath: string, private _status: string) {};

    get decorations(): SourceControlResourceDecorations {
        const light = { iconPath: this._getIconPath('light') };
        const dark = { iconPath: this._getIconPath('dark') };
        let deleted = (this._status.toUpperCase() === 'D');
        const strikeThrough = deleted;
        const faded = deleted;

        return { strikeThrough, faded, light, dark };
    }

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

export class GithdProvider implements Disposable {
    private _disposables: Disposable[] = [];
    private _resourceGroup: SourceControlResourceGroup;
    private _ref: string;

    get ref(): string { return this._ref; }

    constructor() {
        let sc = scm.createSourceControl('githd', 'GitHistoryDiff');
        sc.acceptInputCommand = { command: 'githd.updateSha', title: 'Input the SHA1 code' };
        this._resourceGroup = sc.createResourceGroup('committed', 'Committed Files');
        this._disposables.push(sc, this._resourceGroup);
    }

    clear(): void {
        scm.inputBox.value = null;
        this.update(null);
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    async update(ref: string): Promise<void> {
        if (!ref) {
            this._resourceGroup.resourceStates = [];
            return;
        }
        this._resourceGroup.resourceStates = await this._updateResources(ref);
        this._ref = ref;
        scm.inputBox.value = ref;
        commands.executeCommand('workbench.view.scm');
    }

    private async _updateResources(ref: string): Promise<Resource[]> {
        const files: git.CommittedFile[] = await git.getCommittedFiles(ref);
        return files.map(file => {
            return new Resource(file.uri, file.relativePath, file.status);
        });
    }
}