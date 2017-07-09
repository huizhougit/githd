'use strict'

import { workspace } from 'vscode';
import { spawn } from 'child_process';

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

    export async function exec(args: string[]): Promise<string> {
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
                return { name: `${match[1]}/${match[2]}`, commit: match[3], type: RefType.RemoteHead};
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
}