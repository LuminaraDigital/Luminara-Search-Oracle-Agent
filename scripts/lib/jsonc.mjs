/**
 * Minimal JSONC reader for wrangler.jsonc: strips // and block comments and trailing commas
 * while leaving string contents (for example "https://..." URLs) untouched.
 */

function copyString(text, start) {
  let end = start + 1;
  while (end < text.length && text[end] !== '"') {
    end += text[end] === '\\' ? 2 : 1;
  }
  return end + 1;
}

export function stripJsonc(text) {
  const source = String(text);
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === '"') {
      const end = copyString(source, i);
      out += source.slice(i, end);
      i = end;
    } else if (ch === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
    } else if (ch === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) throw new SyntaxError('Unterminated block comment in JSONC');
      out += ' ';
      i = end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return removeTrailingCommas(out);
}

function removeTrailingCommas(text) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      const end = copyString(text, i);
      out += text.slice(i, end);
      i = end;
      continue;
    }
    if (ch === ',') {
      let j = i + 1;
      while (j < text.length && /\s/.test(text[j])) j++;
      if (text[j] === '}' || text[j] === ']') {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}
