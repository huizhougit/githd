'use strict'

import { window } from 'vscode';

enum TraceLevel {
    Silent,
    Error,
    Warning,
    Info,
    Verbose
}

function isDebugging(): boolean {
    const args = process.execArgv;
    return args && args.some(arg => arg.startsWith('--inspect'));
}

export class Tracer {
    private static _output = window.createOutputChannel('GitHD');
    private static _level: TraceLevel = TraceLevel.Silent;
    private static _debugging = isDebugging();

    static set level(value: string) {
        if (value === 'error') {
            this._level = TraceLevel.Error;
        } else if (value === 'warning') {
            this._level = TraceLevel.Warning;
        } else if (value === 'info') {
            this._level = TraceLevel.Info;
        } else if (value === 'verbose') {
            this._level = TraceLevel.Verbose;
        } else {
            this._level = TraceLevel.Silent;
        }
    }

    static verbose(message: string): void {
        this._log(message, TraceLevel.Verbose);
    }

    static info(message: string): void {
        this._log(message, TraceLevel.Info);
    }

    static warning(message: string): void {
        this._log(message, TraceLevel.Warning);
    }

    static error(message: string): void {
        this._log(message, TraceLevel.Error);
    }

    private static get timestamp(): string {
        return (new Date()).toISOString().split('T')[1].replace('Z', '');
    }

    private static _log(message: string, level: TraceLevel) {
        if (this._debugging || this._level >= level) {
            message = `[${this.timestamp}] ${message}`;
            if (this._debugging) {
                console.log('[GitHD]', message);
            }
            if (this._level >= level) {
                this._output.appendLine(message);
            }
        }
    }
}
