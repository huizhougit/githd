import * as vs from 'vscode';

export function decorateWithoutWhitespace(ranges: vs.Range[], target: string, line: number, offset: number) {
  let start = 0;
  let newWord = true;
  let i = 0;
  for (; i < target.length; ++i) {
    if (target[i] === ' ' || target[i] === '\t' || target[i] === '\n') {
      if (!newWord) {
        newWord = true;
        ranges.push(new vs.Range(line, offset + start, line, offset + i));
      }
    } else {
      if (newWord) {
        newWord = false;
        start = i;
      }
    }
  }
  if (!newWord) {
    ranges.push(new vs.Range(line, offset + start, line, offset + i));
  }
}

export function getTextEditor(document: vs.TextDocument): vs.TextEditor | undefined {
  return vs.window.visibleTextEditors.find(editor => editor.document === document);
}
