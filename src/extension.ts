'use strict';

import { ExtensionContext } from 'vscode'
import { Model } from './model';
import { GitService } from './gitService';
import { CommandCenter } from './commands';
import { HistoryViewProvider } from './historyViewProvider';
import { LineDiffViewProvider } from './lineDiffViewProvider';

export function activate(context: ExtensionContext) {
    let gitService = new GitService();
    let model = new Model(gitService);
    let historyViewProvider = new HistoryViewProvider(model, gitService);
    let lineDiffViewProvider = new LineDiffViewProvider();
    let commandCenter = new CommandCenter(model, gitService, historyViewProvider, lineDiffViewProvider);

    context.subscriptions.push(commandCenter, historyViewProvider, lineDiffViewProvider, model, gitService);
}

export function deactivate() {
}
