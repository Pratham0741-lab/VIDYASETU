export type ComparisonOperator = '<' | '<=' | '>' | '>=' | '==' | '!=' | 'in' | 'matches';
export type ArithmeticOperator = '+' | '-' | '*' | '/';
export type LogicalOperator = '&&' | '||';

export type Literal = number | string | boolean | null;

export type Node =
  | { kind: 'literal'; value: Literal }
  | { kind: 'path'; root: 'applicant' | 'params'; segments: string[] }
  | { kind: 'unary'; operator: '!' | '-'; operand: Node }
  | { kind: 'arithmetic'; operator: ArithmeticOperator; left: Node; right: Node }
  | { kind: 'comparison'; operator: ComparisonOperator; left: Node; right: Node }
  | { kind: 'logical'; operator: LogicalOperator; left: Node; right: Node }
  | { kind: 'conditional'; test: Node; consequent: Node; alternate: Node };

export function pathString(node: Extract<Node, { kind: 'path' }>): string {
  return [node.root, ...node.segments].join('.');
}

function literalSource(value: Literal): string {
  if (typeof value === 'string') return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(value);
}

/** Canonical source text of a node (used to label trace operands). */
export function render(node: Node): string {
  switch (node.kind) {
    case 'literal':
      return literalSource(node.value);
    case 'path':
      return pathString(node);
    case 'unary':
      return `${node.operator}${wrap(node.operand)}`;
    case 'arithmetic':
    case 'comparison':
    case 'logical':
      return `${wrap(node.left)} ${node.operator} ${wrap(node.right)}`;
    case 'conditional':
      return `${wrap(node.test)} ? ${wrap(node.consequent)} : ${wrap(node.alternate)}`;
  }
}

function wrap(node: Node): string {
  return node.kind === 'literal' || node.kind === 'path' || node.kind === 'unary'
    ? render(node)
    : `(${render(node)})`;
}
