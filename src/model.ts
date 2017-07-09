'use strict'

import {
    SourceControlResourceState, SourceControlResourceGroup, scm, SourceControlResourceDecorations,
    Uri, workspace, Disposable, Command
} from 'vscode';
import { git } from './git';
import path = require('path');

const iconsRootPath = path.join(path.dirname(__dirname), '..', 'resources', 'icons');
export function getIconUri(iconName: string, theme: string): Uri {
    return Uri.file(path.join(iconsRootPath, theme, `${iconName}.svg`));
}

function createUri(relativePath: string): Uri {
    const absPath = path.join(workspace.rootPath, relativePath);
    return Uri.file(absPath);
}

export interface LogEntry {
    subject: string;
    hash: string;
    ref: string;
    author: string;
    email: string;
    date: string;
    stat: string;
}

export class Resource implements SourceControlResourceState {
    private static Icons = {
        light: {
            Modified: getIconUri('status-modified', 'light'),
            Added: getIconUri('status-added', 'light'),
            Deleted: getIconUri('status-deleted', 'light'),
            Renamed: getIconUri('status-renamed', 'light'),
            Copied: getIconUri('status-copied', 'light'),
        },
        dark: {
            Modified: getIconUri('status-modified', 'dark'),
            Added: getIconUri('status-added', 'dark'),
            Deleted: getIconUri('status-deleted', 'dark'),
            Renamed: getIconUri('status-renamed', 'dark'),
            Copied: getIconUri('status-copied', 'dark'),
        }
    };

    private _resourceUri: Uri;
    private _file: string;
    private _status: string;

    constructor(info: string) {
        this.parseInfoLine(info);
    }

    get resourceUri(): Uri {
        return this._resourceUri;
    }
    get command(): Command {
        return {
            command: 'githd.openResource',
            title: 'Open',
            arguments: [this]
        }
    }
    get decorations(): SourceControlResourceDecorations {
        const light = { iconPath: this.getIconPath('light') };
        const dark = { iconPath: this.getIconPath('dark') };
        let deleted = (this._status.toUpperCase() === 'D');
        const strikeThrough = deleted;
        const faded = deleted;

        return { strikeThrough, faded, light, dark };
    }

    get file(): string {
        return this._file;
    }

    private getIconPath(theme: string): Uri | undefined {
        switch (this._status[0].toUpperCase()) {
            case 'M': return Resource.Icons[theme].Modified;
            case 'A': return Resource.Icons[theme].Added;
            case 'D': return Resource.Icons[theme].Deleted;
            case 'R': return Resource.Icons[theme].Renamed;
            case 'C': return Resource.Icons[theme].Copied;
            default: return void 0;
        }
    }

    private parseInfoLine(info: string) {
        let contents = info.split(/\t/g);
        if (contents.length < 2) {
            return;
        }
        // A    filename
        // M    filename
        // D    filename
        // RXX  file_old    file_new
        // CXX  file_old    file_new
        switch (contents[0][0].toLocaleUpperCase()) {
            case 'M':
            case 'A':
            case 'D':
                this._file = contents[1];
                break;
            case 'R':
            case 'C':
                this._file = contents[2];
                break;
            default:
                throw new Error('Cannot parse ' + info);
        }
        this._resourceUri = createUri(this._file);
        this._status = contents[0];
    }
}

export class Model implements Disposable {
    private _disposables: Disposable[] = [];
    private _resourceGroup: SourceControlResourceGroup;
    private _sha: string;

    get sha(): string {
        return this._sha;
    }

    constructor() {
        let sc = scm.createSourceControl('githd', 'GitHistoryDiff');
        sc.acceptInputCommand = { command: 'githd.updateSha', title: 'Input the SHA1 code' };
        this._resourceGroup = sc.createResourceGroup('committed', 'Committed Files');
        this._disposables.push(sc, this._resourceGroup);
    }
    dispose(): void {
        this._disposables.forEach(d => d.dispose());
    }

    async update(sha: string): Promise<void> {
        if (!sha) {
            this._resourceGroup.resourceStates = [];
            return;
        }
        this._resourceGroup.resourceStates = await this._updateResources(sha);
    }

    async getLogEntries(start: number, count: number, branch: string): Promise<LogEntry[]> {
        const entrySeparator = '471a2a19-885e-47f8-bff3-db43a3cdfaed';
        const itemSeparator = 'e69fde18-a303-4529-963d-f5b63b7b1664';
        const format = `--format=${entrySeparator}%s${itemSeparator}%h${itemSeparator}%d${itemSeparator}%aN${itemSeparator}%ae${itemSeparator}%cr${itemSeparator}`;
        const result = await git.exec(['log', format, '--shortstat', `--skip=${start}`, `--max-count=${count}`, branch]);
        let entries: LogEntry[] = [];

        result.split(entrySeparator).forEach(entry => {
            if (!entry) {
                return;
            }
            let subject: string;
            let hash: string;
            let ref: string;
            let author: string;
            let email: string;
            let date: string;
            let stat: string;
            entry.split(itemSeparator).forEach((value, index) => {
                // if (index == 0) {
                //     // whitespace
                //     return;
                // }
                // --index;
                switch (index % 7) {
                    case 0:
                        subject = value;
                        break;
                    case 1:
                        hash = value;
                        break;
                    case 2:
                        ref = value;
                        break;
                    case 3:
                        author = value;
                        break;
                    case 4:
                        email = value;
                        break;
                    case 5:
                        date = value;
                        break;
                    case 6:
                        stat = value.replace(/\r?\n*/g, '');
                        entries.push({ subject, hash, ref, author, email, date, stat });
                        break;
                }
            });
        });
        return entries;
    }

    private async _updateResources(sha: string): Promise<Resource[]> {
        const result = await git.exec(['show', '--format=%h', '--name-status', sha]);
        let resources: Resource[] = [];
        result.split(/\r?\n/g).forEach((value, index) => {
            if (index === 0) {
                this._sha = value;
            }
            if (index > 1 && value) {
                resources.push(new Resource(value));
            }
        });
        return resources;
    }
}