import * as path from 'path';

import * as vs from 'vscode';

var iconsRootPath: string;

export function initializeIcons(context: vs.ExtensionContext) {
  iconsRootPath = path.join(context.extensionPath, 'media', 'icons');
}

export function getIconUri(iconName: string, theme: string): vs.Uri {
  return vs.Uri.file(path.join(iconsRootPath, theme, `${iconName}.svg`));
}
