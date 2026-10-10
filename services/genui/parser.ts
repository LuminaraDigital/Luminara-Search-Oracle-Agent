import { ASTNode, ParseResult, Token, TokenType, ActionInvocation, BinaryExpression } from './types';
import { tokenize } from './lexer';

/**
 * Resilient, fault-tolerant streaming statement parser for Luminara GenUI.
 * Translates token stream into an AST node map with auto-closing recovery.
 */
export class GenUIParser {
  private tokens: Token[] = [];
  private pos = 0;
  private nodes = new Map<string, ASTNode>();
  private stateVars = new Map<string, any>();
  private errors: string[] = [];
  private rootId: string | null = null;
  private incomplete = false;

  constructor(input: string) {
    this.tokens = tokenize(input);
  }

  public parse(): ParseResult {
    while (!this.isAtEnd()) {
      // Skip newlines
      if (this.match(TokenType.Newline)) {
        continue;
      }

      try {
        this.parseStatement();
      } catch (err: any) {
        this.errors.push(err.message || 'Parse error');
        this.recoverToNextStatement();
      }
    }

    // Auto-detect root if not explicitly named 'root'
    if (!this.rootId) {
      if (this.nodes.has('root')) {
        this.rootId = 'root';
      } else if (this.nodes.size > 0) {
        const firstKey = this.nodes.keys().next().value;
        if (firstKey) this.rootId = firstKey;
      }
    }

    return {
      nodes: this.nodes,
      rootId: this.rootId,
      stateVars: this.stateVars,
      errors: this.errors,
      incomplete: this.incomplete,
    };
  }

  private parseStatement(): void {
    const token = this.peek();

    // 1. State variable: $var = expr
    if (token.type === TokenType.StateVar) {
      this.advance();
      const varName = String(token.value);
      if (this.match(TokenType.Equals)) {
        const val = this.parseExpression();
        this.stateVars.set(varName, val);
      }
      return;
    }

    // 2. Direct component without assignment: ComponentName(...) -> implicit root
    if (token.type === TokenType.Component && this.peekAhead(1)?.type === TokenType.LParen) {
      const node = this.parseComponentCall('root');
      this.nodes.set('root', node);
      this.rootId = 'root';
      return;
    }

    // 3. Assignment statement: id = Expression
    if (token.type === TokenType.Ident || token.type === TokenType.Component) {
      const id = String(token.value);
      this.advance();

      if (this.match(TokenType.Equals)) {
        const nextToken = this.peek();
        if (nextToken.type === TokenType.Component) {
          const node = this.parseComponentCall(id);
          this.nodes.set(id, node);
          if (id === 'root') this.rootId = 'root';
        } else {
          // General expression assigned to variable
          const expr = this.parseExpression();
          this.stateVars.set(id, expr);
        }
      }
      return;
    }

    // Unexpected statement start, advance
    this.advance();
  }

  private parseComponentCall(id: string): ASTNode {
    const compToken = this.advance();
    const component = String(compToken.value);

    // Expect '('
    if (!this.match(TokenType.LParen)) {
      return { id, component, args: [], isComplete: false };
    }

    const args: any[] = [];
    const namedArgs: Record<string, any> = {};
    let isComplete = false;

    while (!this.isAtEnd()) {
      if (this.peek().type === TokenType.RParen) {
        this.advance();
        isComplete = true;
        break;
      }

      if (this.peek().type === TokenType.Newline) {
        this.advance();
        continue;
      }

      // Check if named argument: name: value
      if (this.peek().type === TokenType.Ident && this.peekAhead(1)?.type === TokenType.Colon) {
        const key = String(this.advance().value);
        this.advance(); // consume ':'
        const val = this.parseExpression();
        namedArgs[key] = val;
      } else {
        const arg = this.parseExpression();
        args.push(arg);
      }

      if (this.match(TokenType.Comma)) {
        continue;
      } else if (this.peek().type === TokenType.RParen) {
        this.advance();
        isComplete = true;
        break;
      } else if (this.peek().type === TokenType.Newline || this.isAtEnd()) {
        // Stream ended or line ended before ')'
        this.incomplete = true;
        break;
      } else {
        this.advance();
      }
    }

    return { id, component, args, namedArgs, isComplete };
  }

  private parseExpression(): any {
    let expr = this.parsePrimary();

    while (this.match(TokenType.Plus)) {
      const right = this.parsePrimary();
      expr = {
        __isBinary: true,
        op: '+',
        left: expr,
        right,
      } as BinaryExpression;
    }

    return expr;
  }

  private parsePrimary(): any {
    const token = this.peek();

    // Primitives
    if (token.type === TokenType.Str || token.type === TokenType.Num ||
        token.type === TokenType.True || token.type === TokenType.False ||
        token.type === TokenType.Null) {
      this.advance();
      return token.value;
    }

    // State reference: $var
    if (token.type === TokenType.StateVar) {
      this.advance();
      return { __isStateRef: true, name: token.value };
    }

    // Action invocation: @Action("name", payload) or @Run(...)
    if (token.type === TokenType.Action) {
      return this.parseActionInvocation();
    }

    // Nested Component Call: CompName(...)
    if (token.type === TokenType.Component && this.peekAhead(1)?.type === TokenType.LParen) {
      const anonId = `anon_${Math.random().toString(36).slice(2, 8)}`;
      const node = this.parseComponentCall(anonId);
      this.nodes.set(anonId, node);
      return anonId;
    }

    // Variable / Identifier reference
    if (token.type === TokenType.Ident || token.type === TokenType.Component) {
      this.advance();
      return String(token.value);
    }

    // Array: [expr1, expr2, ...]
    if (this.match(TokenType.LBrack)) {
      return this.parseArray();
    }

    // Object: { key: value, ... }
    if (this.match(TokenType.LBrace)) {
      return this.parseObject();
    }

    // Fallback: return token value and advance
    this.advance();
    return token.value ?? null;
  }

  private parseActionInvocation(): ActionInvocation {
    const actionToken = this.advance();
    let actionName = String(actionToken.value || 'Action');

    let payload: any = null;
    if (this.match(TokenType.LParen)) {
      const args: any[] = [];
      while (!this.isAtEnd() && this.peek().type !== TokenType.RParen && this.peek().type !== TokenType.Newline) {
        args.push(this.parseExpression());
        if (!this.match(TokenType.Comma)) break;
      }
      this.match(TokenType.RParen);

      if ((actionName.toLowerCase() === 'action' || actionName.toLowerCase() === 'run') && args.length > 0) {
        actionName = String(args[0]);
        payload = args.length === 2 ? args[1] : (args.length > 2 ? args.slice(1) : null);
      } else {
        payload = args.length === 1 ? args[0] : (args.length > 1 ? args : null);
      }
    }

    return {
      __isAction: true,
      name: actionName,
      payload,
    };
  }

  private parseArray(): any[] {
    const arr: any[] = [];
    while (!this.isAtEnd()) {
      if (this.match(TokenType.RBrack)) {
        return arr;
      }
      if (this.match(TokenType.Newline)) continue;

      arr.push(this.parseExpression());

      if (this.match(TokenType.Comma)) {
        continue;
      } else if (this.match(TokenType.RBrack)) {
        return arr;
      } else if (this.peek().type === TokenType.Newline || this.isAtEnd()) {
        this.incomplete = true;
        break; // Auto-close array on stream chunk end
      }
    }
    return arr;
  }

  private parseObject(): Record<string, any> {
    const obj: Record<string, any> = {};
    while (!this.isAtEnd()) {
      if (this.match(TokenType.RBrace)) {
        return obj;
      }
      if (this.match(TokenType.Newline)) continue;

      const keyToken = this.peek();
      if (keyToken.type === TokenType.Ident || keyToken.type === TokenType.Str) {
        this.advance();
        const key = String(keyToken.value);
        if (this.match(TokenType.Colon)) {
          obj[key] = this.parseExpression();
        }
      }

      if (this.match(TokenType.Comma)) {
        continue;
      } else if (this.match(TokenType.RBrace)) {
        return obj;
      } else if (this.peek().type === TokenType.Newline || this.isAtEnd()) {
        this.incomplete = true;
        break; // Auto-close object on stream chunk end
      }
    }
    return obj;
  }

  private recoverToNextStatement(): void {
    while (!this.isAtEnd() && this.peek().type !== TokenType.Newline) {
      this.advance();
    }
  }

  private peek(): Token {
    return this.tokens[this.pos] || { type: TokenType.EOF };
  }

  private peekAhead(offset: number): Token | undefined {
    return this.tokens[this.pos + offset];
  }

  private advance(): Token {
    const token = this.peek();
    if (!this.isAtEnd()) {
      this.pos++;
    }
    return token;
  }

  private match(type: TokenType): boolean {
    if (this.peek().type === type) {
      this.advance();
      return true;
    }
    return false;
  }

  private isAtEnd(): boolean {
    return this.pos >= this.tokens.length || this.peek().type === TokenType.EOF;
  }
}

/** Convenience helper function */
export function parseGenUI(input: string): ParseResult {
  const parser = new GenUIParser(input);
  return parser.parse();
}
