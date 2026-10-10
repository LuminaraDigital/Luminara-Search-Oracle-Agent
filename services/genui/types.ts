/**
 * Luminara GenUI (Generative UI) Types
 * Zero-dependency, stream-first declarative component DSL specification.
 */

export const enum TokenType {
  Newline = 0,
  LParen = 1,     // (
  RParen = 2,     // )
  LBrack = 3,     // [
  RBrack = 4,     // ]
  LBrace = 5,     // {
  RBrace = 6,     // }
  Comma = 7,      // ,
  Colon = 8,      // :
  Equals = 9,     // =
  True = 10,
  False = 11,
  Null = 12,
  Str = 13,       // String literal
  Num = 14,       // Numeric literal
  Ident = 15,     // Lowercase identifier (variable reference)
  Component = 16, // PascalCase identifier (component name)
  StateVar = 17,  // $variable
  Action = 18,    // @Action("name", payload)
  Plus = 19,      // +
  EOF = 20,
}

export interface Token {
  type: TokenType;
  value?: string | number | boolean | null;
  raw?: string;
}

export interface ActionInvocation {
  __isAction: true;
  name: string;
  payload: any;
}

export interface BinaryExpression {
  __isBinary: true;
  op: '+';
  left: any;
  right: any;
}

export interface ASTNode {
  id: string;
  component: string;
  args: any[];
  namedArgs?: Record<string, any>;
  isComplete: boolean;
}

export interface ParseResult {
  nodes: Map<string, ASTNode>;
  rootId: string | null;
  stateVars: Map<string, any>;
  errors: string[];
  incomplete: boolean;
}

export type ActionHandler = (actionName: string, payload: any) => void | Promise<void>;

export interface ComponentPropsAdapter {
  (node: ASTNode, resolvedArgs: any[], actionHandler?: ActionHandler): Record<string, any>;
}

export interface GenUIComponentDef {
  component: React.ComponentType<any>;
  adapter?: ComponentPropsAdapter;
  signature: string;
  description: string;
}

export type ComponentRegistry = Record<string, GenUIComponentDef | React.ComponentType<any>>;
