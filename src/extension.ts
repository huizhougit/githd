import * as vs from 'vscode';

import { Model } from './model';
import { GitService } from './gitService';
import { CommandCenter } from './commands';
import { HistoryViewProvider } from './historyViewProvider';
import { ExplorerViewProvider } from './explorerViewProvider';
import { InfoViewProvider } from './infoViewProvider';
import { BlameViewProvider } from './blameViewProvider';
import { Dataloader } from './dataloader';
import { PanelViewProvider } from './panelViewProvider';
import { initializeIcons } from './icons';

export function activate(context: vs.ExtensionContext) {
  initializeIcons(context);
  let gitService = new GitService(context);
  let dataloader = new Dataloader(context, gitService);
  let model = new Model(context, dataloader);
  let panelView = new PanelViewProvider(context, model);
  let historyViewProvider = new HistoryViewProvider(context, model, dataloader, gitService, panelView);
  let explorerViewProvider = new ExplorerViewProvider(context, model, dataloader, gitService);
  new InfoViewProvider(context, model, gitService);
  new BlameViewProvider(context, model, gitService);
  new CommandCenter(context, model, dataloader, gitService, historyViewProvider, explorerViewProvider);
  gitService.updateGitRoots(vs.workspace.workspaceFolders);
}

export function deactivate() {}
