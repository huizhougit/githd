'use strict'

import { Uri } from 'vscode';

import { ScmViewProvider } from './scmViewProvider';
import { ExplorerViewProvider } from './explorerViewProvider';

export interface FileProvider {
    leftRef: string;
    rightRef: string;
    update(leftRef: string, rightRef: string, specifiedFile?: Uri): void;
    clear(): void;
    dispose(): void;
}

export function createFileProvider(inExplorer?: boolean, withFolder?: boolean): FileProvider {
    if (inExplorer) {
        return new ExplorerViewProvider(withFolder);
    }
    return new ScmViewProvider();
}
