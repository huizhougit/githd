import * as vs from 'vscode';

export class Resource {
  static getGitStatusColor(status: string): vs.ThemeColor | undefined {
    switch (status) {
      case 'M':
        return; // majority of files are modified, we don't need to show color
      case 'D':
        return new vs.ThemeColor('gitDecoration.deletedResourceForeground');
      case 'A':
        return new vs.ThemeColor('gitDecoration.addedResourceForeground');
      case 'C':
      case 'R':
        return new vs.ThemeColor('gitDecoration.renamedResourceForeground');
      default:
    }
    return;
  }
}
