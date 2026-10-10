import { Token, TokenType } from './types';

/**
 * High-performance streaming lexer for Luminara GenUI.
 * Resilient against incomplete streaming chunks with auto-closing string recovery.
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  const len = input.length;
  let i = 0;

  while (i < len) {
    const ch = input[i];

    // Newlines
    if (ch === '\n' || ch === '\r') {
      if (tokens.length > 0 && tokens[tokens.length - 1].type !== TokenType.Newline) {
        tokens.push({ type: TokenType.Newline });
      }
      i++;
      continue;
    }

    // Skip whitespace
    if (ch === ' ' || ch === '\t') {
      i++;
      continue;
    }

    // Comments: // or #
    if (ch === '#' || (ch === '/' && input[i + 1] === '/')) {
      while (i < len && input[i] !== '\n' && input[i] !== '\r') {
        i++;
      }
      continue;
    }

    // Punctuation & Operators
    if (ch === '(') { tokens.push({ type: TokenType.LParen }); i++; continue; }
    if (ch === ')') { tokens.push({ type: TokenType.RParen }); i++; continue; }
    if (ch === '[') { tokens.push({ type: TokenType.LBrack }); i++; continue; }
    if (ch === ']') { tokens.push({ type: TokenType.RBrack }); i++; continue; }
    if (ch === '{') { tokens.push({ type: TokenType.LBrace }); i++; continue; }
    if (ch === '}') { tokens.push({ type: TokenType.RBrace }); i++; continue; }
    if (ch === ',') { tokens.push({ type: TokenType.Comma }); i++; continue; }
    if (ch === ':') { tokens.push({ type: TokenType.Colon }); i++; continue; }
    if (ch === '=') { tokens.push({ type: TokenType.Equals }); i++; continue; }
    if (ch === '+') { tokens.push({ type: TokenType.Plus }); i++; continue; }

    // Strings (double or single quotes)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      let strVal = '';
      let escaped = false;
      while (i < len) {
        const c = input[i];
        if (escaped) {
          if (c === 'n') strVal += '\n';
          else if (c === 't') strVal += '\t';
          else strVal += c;
          escaped = false;
          i++;
        } else if (c === '\\') {
          escaped = true;
          i++;
        } else if (c === quote) {
          i++; // Close quote
          break;
        } else {
          strVal += c;
          i++;
        }
      }
      tokens.push({ type: TokenType.Str, value: strVal, raw: strVal });
      continue;
    }

    // Action Invocation: @Action or @identifier
    if (ch === '@') {
      i++;
      let ident = '';
      while (i < len && /[a-zA-Z0-9_]/.test(input[i])) {
        ident += input[i];
        i++;
      }
      tokens.push({ type: TokenType.Action, value: ident });
      continue;
    }

    // State variable: $var
    if (ch === '$') {
      i++;
      let varName = '';
      while (i < len && /[a-zA-Z0-9_]/.test(input[i])) {
        varName += input[i];
        i++;
      }
      tokens.push({ type: TokenType.StateVar, value: varName });
      continue;
    }

    // Numbers (including negative numbers and floats)
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(input[i + 1] || ''))) {
      let numStr = '';
      if (ch === '-') {
        numStr += '-';
        i++;
      }
      while (i < len && /[0-9.]/.test(input[i])) {
        numStr += input[i];
        i++;
      }
      const numVal = parseFloat(numStr);
      tokens.push({ type: TokenType.Num, value: isNaN(numVal) ? 0 : numVal, raw: numStr });
      continue;
    }

    // Identifiers & Keywords
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = '';
      while (i < len && /[a-zA-Z0-9_]/.test(input[i])) {
        ident += input[i];
        i++;
      }

      if (ident === 'true') {
        tokens.push({ type: TokenType.True, value: true });
      } else if (ident === 'false') {
        tokens.push({ type: TokenType.False, value: false });
      } else if (ident === 'null' || ident === 'undefined') {
        tokens.push({ type: TokenType.Null, value: null });
      } else if (/^[A-Z]/.test(ident)) {
        tokens.push({ type: TokenType.Component, value: ident });
      } else {
        tokens.push({ type: TokenType.Ident, value: ident });
      }
      continue;
    }

    // Fallback advance for unrecognized character
    i++;
  }

  tokens.push({ type: TokenType.EOF });
  return tokens;
}
