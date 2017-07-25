'use strict'

import {
    SourceControlResourceState, SourceControlResourceGroup, scm, SourceControlResourceDecorations,
    Uri, workspace, Disposable, Command, commands
} from 'vscode';
import { git } from './git';
import { Icons } from './icons';
import path = require('path');

export class Resource implements SourceControlResourceState, git.CommittedFile {
    readonly uri: Uri = this._uri;
    readonly gitRelativePath: string = this._gitRelativePath;
    readonly status: string = this._status;
    readonly resourceUri: Uri = this._uri;
    readonly command: Command = { title: '', command: 'githd.openCommittedFile', arguments: [this] };

    constructor(private _uri: Uri, private _gitRelativePath: string, private _status: string) {};

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

export class ScmViewProvider implements Disposable {
    private _disposables: Disposable[] = [];
    private _resourceGroup: SourceControlResourceGroup;
    private _leftRef: string;
    private _rightRef: string;

    constructor() {
        let sc = scm.createSourceControl('githd', 'GitHistoryDiff');
        sc.acceptInputCommand = { command: 'githd.updateSha', title: 'Input the SHA1 code' };
        this._resourceGroup = sc.createResourceGroup('committed', 'Committed Files');
        this._disposables.push(sc, this._resourceGroup);
    }
    get leftRef(): string { return this._leftRef; }
    get rightRef(): string { return this._rightRef; }

    clear(): void {
        this.update(null, null);
    }

    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    async update(leftRef: string, rightRef: string, specifiedFile?: Uri): Promise<void> {
        this._leftRef = leftRef;
        this._rightRef = rightRef;
        scm.inputBox.value = rightRef;
        if (!rightRef) {
            this._resourceGroup.resourceStates = [];
            return;
        }
        if (leftRef) {
            scm.inputBox.value = `${leftRef} .. ${rightRef}`;
        }
        this._resourceGroup.resourceStates = await this._updateResources(leftRef, rightRef);
        commands.executeCommand('workbench.view.scm');
    }

    private async _updateResources(leftRef: string, rightRef: string): Promise<Resource[]> {
        const files: git.CommittedFile[] = await git.getCommittedFiles(leftRef, rightRef);
        return files.map(file => {
            return new Resource(file.uri, file.gitRelativePath, file.status);
        });
    }
}