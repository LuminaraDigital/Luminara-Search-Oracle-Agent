import React from 'react';
import { ASTNode, ActionHandler, ActionInvocation, BinaryExpression, ComponentRegistry, GenUIComponentDef, ParseResult } from './types';

/**
 * Materializes an AST node tree into live React elements.
 * Resolves variable references, state bindings, binary expressions, and action handlers.
 */
export function materializeNode(
  nodeId: string,
  result: ParseResult,
  registry: ComponentRegistry,
  actionHandler?: ActionHandler,
  visited = new Set<string>()
): React.ReactNode {
  if (visited.has(nodeId)) {
    console.warn(`[GenUI] Circular reference detected for node "${nodeId}"`);
    return null;
  }
  visited.add(nodeId);

  const node = result.nodes.get(nodeId);
  if (!node) {
    return null;
  }

  const def = registry[node.component];
  if (!def) {
    return React.createElement(
      'div',
      {
        key: node.id,
        className: 'p-3 my-2 rounded-xl border border-warning-500/30 bg-warning-950/20 text-warning-200 text-xs font-mono',
      },
      `[Unregistered GenUI Component: <${node.component} />]`
    );
  }

  const Component = typeof def === 'function' ? def : (def as GenUIComponentDef).component;
  const adapter = typeof def === 'object' && def !== null && 'adapter' in def ? def.adapter : undefined;

  // Resolve positional and named arguments
  const resolvedArgs = node.args.map((arg) => resolveValue(arg, result, registry, actionHandler, new Set(visited)));

  // If a dedicated props adapter is provided, use it
  if (adapter) {
    const props = adapter(node, resolvedArgs, actionHandler);
    return React.createElement(Component, { key: node.id, ...props });
  }

  // Default adapter heuristic
  const props: Record<string, any> = {
    key: node.id,
    id: node.id,
    isComplete: node.isComplete,
  };

  // If named args were provided, resolve and merge them
  if (node.namedArgs && Object.keys(node.namedArgs).length > 0) {
    for (const [k, v] of Object.entries(node.namedArgs)) {
      props[k] = resolveValue(v, result, registry, actionHandler, new Set(visited));
    }
  }

  // Handle standard positional signatures
  if (resolvedArgs.length > 0) {
    // If the first argument is an array of React elements, treat as children
    if (Array.isArray(resolvedArgs[0]) && resolvedArgs[0].every(React.isValidElement)) {
      props.children = resolvedArgs[0];
    } else if (typeof resolvedArgs[0] === 'object' && resolvedArgs[0] !== null && !React.isValidElement(resolvedArgs[0]) && !Array.isArray(resolvedArgs[0])) {
      // First arg is an object payload, spread it
      Object.assign(props, resolvedArgs[0]);
    } else {
      // Pass raw args array for components that inspect positional args
      props.args = resolvedArgs;
      // Also provide standard primary props for common signatures: title, value, variant
      if (typeof resolvedArgs[0] === 'string') props.title = resolvedArgs[0];
      if (resolvedArgs[1] !== undefined) props.value = resolvedArgs[1];
      if (resolvedArgs[2] !== undefined) props.variant = resolvedArgs[2];
    }
  }

  return React.createElement(Component, props);
}

function resolveValue(
  value: any,
  result: ParseResult,
  registry: ComponentRegistry,
  actionHandler?: ActionHandler,
  visited = new Set<string>()
): any {
  if (value === null || value === undefined) return value;

  // Binary expression: left + right
  if (typeof value === 'object' && value.__isBinary && value.op === '+') {
    const bin = value as BinaryExpression;
    const left = resolveValue(bin.left, result, registry, actionHandler, visited);
    const right = resolveValue(bin.right, result, registry, actionHandler, visited);
    return String(left ?? '') + String(right ?? '');
  }

  // State reference: $var
  if (typeof value === 'object' && value.__isStateRef) {
    const varName = value.name;
    return result.stateVars.has(varName) ? result.stateVars.get(varName) : null;
  }

  // Action Invocation: @Action("name", payload)
  if (typeof value === 'object' && value.__isAction) {
    const action = value as ActionInvocation;
    return () => {
      if (actionHandler) {
        actionHandler(action.name, action.payload);
      } else {
        window.dispatchEvent(
          new CustomEvent('luminara-genui-action', {
            detail: { action: action.name, payload: action.payload },
          })
        );
      }
    };
  }

  // Node ID reference: if string matches another node, materialize it
  if (typeof value === 'string' && result.nodes.has(value)) {
    return materializeNode(value, result, registry, actionHandler, visited);
  }

  // Array of items
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, result, registry, actionHandler, visited));
  }

  // Object of items
  if (typeof value === 'object' && !React.isValidElement(value)) {
    const resolvedObj: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      resolvedObj[k] = resolveValue(v, result, registry, actionHandler, visited);
    }
    return resolvedObj;
  }

  return value;
}
