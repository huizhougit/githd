'use strict'

import { Range } from 'vscode';

export function decorateWithoutWhitspace(ranges: Range[], target: string, line: number, offset: number): void {
    let start = 0;
    let newWord = true;
    let i = 0;
    for (; i < target.length; ++i) {
        if (target[i] === ' ' || target[i] === '\t' || target[i] === '\n') {
            if (!newWord) {
                newWord = true;
                ranges.push(new Range(line, offset + start, line, offset + i));
            }
        } else {
            if (newWord) {
                newWord = false;
                start = i;
            }
        }
    }
    if (!newWord) {
        ranges.push(new Range(line, offset + start, line, offset + i));
    }
}