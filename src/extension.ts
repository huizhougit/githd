'use strict';
// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import { ExtensionContext } from 'vscode'
import { Resource, Model } from './model';
import { CommandCenter } from './commands';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: ExtensionContext) {
    let model = new Model();
    let commandCenter = new CommandCenter(model);
    context.subscriptions.push(commandCenter, model);
}

// this method is called when your extension is deactivated
export function deactivate() {
}
