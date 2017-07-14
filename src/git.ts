'use strict'

import { workspace, Uri } from 'vscode';
import { spawn } from 'child_process';
import path = require('path');

export namespace git {

    export enum RefType {
        Head,
        RemoteHead,
        Tag
    }
    export interface Ref {
        type: RefType;
        name?: string;
        commit?: string;
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

    export interface CommittedFile {
        uri: Uri;
        relativePath: string;
        status: string;
    }

    async function exec(args: string[]): Promise<string> {
        let content: string = '';
        let gitShow = spawn('git', args, { cwd: workspace.rootPath });
        let out = gitShow.stdout;
        out.setEncoding('utf8');
        return new Promise<string>((resolve, reject) => {
            out.on('data', data => content += data);
            out.on('end', () => resolve(content));
            out.on('error', err => reject(err));
        });
    }

    async function getGitRoot(): Promise<string> {
        return (await exec(['rev-parse', '--show-toplevel'])).trim();
    }

    export async function getCurrentBranch(): Promise<string> {
        return (await exec(['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    }

    export async function getCommitsCount(): Promise<number> {
        return parseInt(await exec(['rev-list', '--count', 'HEAD']));
    }

    export async function getRefs(): Promise<Ref[]> {
        const result = await exec(['for-each-ref', '--format', '%(refname) %(objectname:short)']);

        const fn = (line): Ref | null => {
            let match: RegExpExecArray | null;

            if (match = /^refs\/heads\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: match[1], commit: match[2], type: RefType.Head };
            } else if (match = /^refs\/remotes\/([^/]+)\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: `${match[1]}/${match[2]}`, commit: match[3], type: RefType.RemoteHead };
            } else if (match = /^refs\/tags\/([^ ]+) ([0-9a-f]+)$/.exec(line)) {
                return { name: match[1], commit: match[2], type: RefType.Tag };
            }

            return null;
        };

        return result.trim().split('\n')
            .filter(line => !!line)
            .map(fn)
            .filter(ref => !!ref) as Ref[];
    }

    export async function getCommittedFiles(ref: string): Promise<CommittedFile[]> {
        const gitRootPath = await getGitRoot();
        const result = await exec(['show', '--format=%h', '--name-status', ref]);
        let files: CommittedFile[] = [];
        result.split(/\r?\n/g).forEach((value, index) => {
            if (index > 1 && value) {
                let info = value.split(/\t/g);
                if (info.length < 2) {
                    return;
                }
                let relativePath: string;
                const status: string = info[0][0].toLocaleUpperCase();
                // A    filename
                // M    filename
                // D    filename
                // RXX  file_old    file_new
                // CXX  file_old    file_new
                switch (status) {
                    case 'M':
                    case 'A':
                    case 'D':
                        relativePath = info[1];
                        break;
                    case 'R':
                    case 'C':
                        relativePath = info[2];
                        break;
                    default:
                        throw new Error('Cannot parse ' + info);
                }
                files.push({ relativePath, status, uri: Uri.file(path.join(gitRootPath, relativePath)) });
            }
        });
        return files;
    }

    export async function getLogEntries(start: number, count: number, branch: string): Promise<LogEntry[]> {
        const entrySeparator = '471a2a19-885e-47f8-bff3-db43a3cdfaed';
        const itemSeparator = 'e69fde18-a303-4529-963d-f5b63b7b1664';
        const format = `--format=${entrySeparator}%s${itemSeparator}%h${itemSeparator}%d${itemSeparator}%aN${itemSeparator}%ae${itemSeparator}%cr${itemSeparator}`;
        const result = await exec(['log', format, '--shortstat', `--skip=${start}`, `--max-count=${count}`, branch]);
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

}