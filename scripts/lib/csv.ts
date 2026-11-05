/** Small strict RFC 4180 reader, including embedded CR/LF, escaped quotes and BOM. */
export function parseCsv(source: string): string[][] {
  const text = source.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false;
  const finishField = () => {
    row.push(field);
    field = '';
    closed = false;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ',') finishField();
    else if (c === '\r' || c === '\n') {
      finishField();
      rows.push(row);
      row = [];
      if (c === '\r' && text[i + 1] === '\n') i++;
    } else if (closed) throw new Error('Unexpected character after quoted CSV field');
    else if (c === '"') {
      if (field) throw new Error('Quote inside unquoted CSV field');
      quoted = true;
    } else field += c;
  }
  if (quoted) throw new Error('Unterminated quoted CSV field');
  if (field || row.length || closed) {
    finishField();
    rows.push(row);
  }
  return rows;
}
