'use strict';

import { ExtensionContext } from 'vscode'
import { Model } from './model';
import { CommandCenter } from './commands';
import { HistoryViewProvider } from './historyViewProvider';
import { HistoryHtmlViewProvider } from './historyHtmlViewProvider';

export function activate(context: ExtensionContext) {
    let model = new Model();
    let historyViewProvider = new HistoryViewProvider(model);
    let historyViewProvider2 = new HistoryHtmlViewProvider(model);
    let commandCenter = new CommandCenter(model, historyViewProvider2);

    context.subscriptions.push(commandCenter, historyViewProvider, historyViewProvider2, model);
}

export function deactivate() {
}
