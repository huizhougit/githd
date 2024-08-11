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
  let explorerViewProvider = new ExplorerViewProvider(context, model, gitService);
  new InfoViewProvider(context, model, gitService);
  new BlameViewProvider(context, model, gitService);
  new CommandCenter(context, model, gitService, historyViewProvider, explorerViewProvider);
}

export function deactivate() {}
