'use strict'

import { GithdProvider } from './scmProvider';
import { CommittedFilesProvider } from './committedFilesProvider';

export const explorerViewName = 'Explorer';

export interface FileProvider {
    ref: string;
    update(ref: string): void;
    clear(): void;
    dispose(): void;
}

export function createFileProvider(inExplorer?: boolean, withFolder?: boolean): FileProvider {
    if (inExplorer) {
        return new CommittedFilesProvider(withFolder);
    }
    return new GithdProvider();
}
