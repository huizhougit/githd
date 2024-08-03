import * as vs from 'vscode';

import { Model } from './model';
import { GitService } from './gitService';
import { CommandCenter } from './commands';
import { HistoryViewProvider } from './historyViewProvider';
import { ExplorerViewProvider } from './explorerViewProvider';
import { InfoViewProvider } from './infoViewProvider';
import { BlameViewProvider } from './blameViewProvider';

export function activate(context: vs.ExtensionContext) {
  let gitService = new GitService(context);
  let model = new Model(context, gitService);
  let historyViewProvider = new HistoryViewProvider(context, model, gitService);
  let infoViewProvider = new InfoViewProvider(context, model, gitService);
  let explorerViewProvider = new ExplorerViewProvider(context, model, gitService);
  new BlameViewProvider(context, model, gitService);
  new CommandCenter(context, model, gitService, historyViewProvider, infoViewProvider);
  let explorerView = vs.window.createTreeView('committedFiles', {
    treeDataProvider: explorerViewProvider,
    showCollapseAll: true
  });

  vs.window.onDidChangeActiveTextEditor(async (editor: vs.TextEditor | undefined) => {
    if (editor && model.configuration.followEditor) {
      const item = await explorerViewProvider.findItemByPath(editor.document.fileName);
      if (item && explorerView.visible) {
        explorerView.reveal(item);
      }
    }
  });
}

export function deactivate() {}
