'use strict';

import { ExtensionContext } from 'vscode'
import { Model } from './model';
import { CommandCenter } from './commands';
import { HistoryViewProvider } from './historyViewProvider';
import { LineDiffViewProvider } from './lineDiffViewProvider';

export function activate(context: ExtensionContext) {
    let model = new Model();
    let historyViewProvider = new HistoryViewProvider(model);
    let lineDiffViewProvider = new LineDiffViewProvider();
    let commandCenter = new CommandCenter(model, historyViewProvider, lineDiffViewProvider);

    context.subscriptions.push(commandCenter, historyViewProvider, lineDiffViewProvider, model);
}

export function deactivate() {
}
