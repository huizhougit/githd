'use strict'

import * as path from 'path';

import {
    SourceControlResourceState, SourceControlResourceGroup, SourceControl, scm, SourceControlResourceDecorations,
    Uri, workspace, Disposable, Command, commands
} from 'vscode';

import { git } from './git';
import { Icons } from './icons';
import { Model, FilesViewContext } from './model'

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

export class ScmViewProvider {
    private _disposables: Disposable[] = [];
    private _resourceGroup: SourceControlResourceGroup;
    private _sc: SourceControl;

    constructor(model: Model) {
        this._sc = scm.createSourceControl('githd', 'GitHistoryDiff');
        this._sc.acceptInputCommand = { command: 'githd.updateRef', title: 'Input the SHA1 code', arguments: [this._sc.inputBox.value] };
        this._resourceGroup = this._sc.createResourceGroup('committed', 'Committed Files');
        this._disposables.push(this._sc, this._resourceGroup);
        model.onDidChangeFilesViewContext(context => this._update(context), null, this._disposables);
        this._update(model.filesViewContext);
    }

    dispose(): void {
        this._sc.inputBox.value = '';
        this._disposables.forEach(d => d.dispose());
    }

    private async _update(context: FilesViewContext): Promise<void> {
        const leftRef = context.leftRef;
        const rightRef = context.rightRef;
        this._sc.inputBox.value = rightRef;
        if (!rightRef) {
            this._resourceGroup.resourceStates = [];
            return;
        }
        if (leftRef) {
            this._sc.inputBox.value = `${leftRef} .. ${rightRef}`;
        }
        this._resourceGroup.resourceStates = await this._updateResources(context.repo, context.leftRef, context.rightRef);
        commands.executeCommand('workbench.view.scm');
    }

    private async _updateResources(repo: git.GitRepo, leftRef: string, rightRef: string): Promise<Resource[]> {
        const files: git.CommittedFile[] = await git.getCommittedFiles(repo, leftRef, rightRef);
        return files.map(file => {
            return new Resource(file.uri, file.gitRelativePath, file.status);
        });
    }
}