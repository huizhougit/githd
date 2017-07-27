'use strict';

import { ExtensionContext } from 'vscode'
import { Model } from './model';
import { CommandCenter } from './commands';
import { HistoryViewProvider } from './historyViewProvider';

export function activate(context: ExtensionContext) {
    let model = new Model();
    let historyViewProvider = new HistoryViewProvider(model);
    let commandCenter = new CommandCenter(model, historyViewProvider);

    context.subscriptions.push(commandCenter, historyViewProvider, model);
}

export function deactivate() {
}
