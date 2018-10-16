'use strict';

import { ExtensionContext } from 'vscode'
import { Model } from './model';
import { GitService } from './gitService';
import { CommandCenter } from './commands';
import { HistoryViewProvider } from './historyViewProvider';
import { ExplorerViewProvider } from './explorerViewProvider';
import { InfoViewProvider } from './infoViewProvider';
import { BlameViewProvider } from './blameViewProvider';

export function activate(context: ExtensionContext) {
    let gitService = new GitService();
    let model = new Model(gitService);
    let historyViewProvider = new HistoryViewProvider(model, gitService);
    let infoViewProvider = new InfoViewProvider(model, gitService);
    let explorerProvider = new ExplorerViewProvider(model, gitService);
    let blameViewProvider = new BlameViewProvider(model, gitService);
    let commandCenter = new CommandCenter(model, gitService, historyViewProvider, infoViewProvider);

    context.subscriptions.push(gitService, model, historyViewProvider, infoViewProvider, explorerProvider, commandCenter, blameViewProvider);
}

export function deactivate() {
}
