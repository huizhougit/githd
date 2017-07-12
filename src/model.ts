'use strict'

import { GithdProvider } from './scmProvider';
import { CommittedFilesProvider } from './committedFilesProvider';

export interface FileProvider {
    ref: string;
    update(ref: string): void;
    clear(): void;
    dispose(): void;
}

export function createFileProvider(exploreView?: boolean, treeView?: boolean): FileProvider {
    if (exploreView) {
        return new CommittedFilesProvider(treeView);
    }
    return new GithdProvider();
}
