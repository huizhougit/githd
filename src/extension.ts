import * as vs from 'vscode';

import { Model } from './model';
import { GitService } from './gitService';
import { CommandCenter } from './commands';
import { HistoryViewProvider } from './historyViewProvider';
import { ExplorerViewProvider } from './explorerViewProvider';
import { InfoViewProvider } from './infoViewProvider';
import { BlameViewProvider } from './blameViewProvider';
import { Dataloader } from './dataloader';

export function activate(context: vs.ExtensionContext) {
  let gitService = new GitService(context);
  let dataloader = new Dataloader(context, gitService);
  let model = new Model(context, dataloader);
  let historyViewProvider = new HistoryViewProvider(context, model, dataloader, gitService);
  let explorerViewProvider = new ExplorerViewProvider(context, model, dataloader, gitService);
  new InfoViewProvider(context, model, gitService);
  new BlameViewProvider(context, model, gitService);
  new CommandCenter(context, model, dataloader, gitService, historyViewProvider, explorerViewProvider);
}

export function deactivate() {}
