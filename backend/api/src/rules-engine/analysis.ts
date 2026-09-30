import { Node, pathString } from './ast';

export type InferredType = 'number' | 'text' | 'boolean' | 'unknown';

export interface PathReference {
  path: string;
  /** Types implied by how the path is used (e.g. arithmetic => number). */
  types: Set<InferredType>;
  /** params.* paths this applicant path is compared against. */
  comparedWith: Set<string>;
  /** Text literals this path is compared with via == / != (candidate values). */
  literalValues: Set<string>;
}

/**
 * Walks an AST and collects every applicant.* path it references, with how
 * each is used. This is what makes the form schema data-driven: it is
 * computed from whatever rules a scheme version has.
 */
export function collectApplicantPaths(node: Node, into = new Map<string, PathReference>()) {
  walk(node, into, null);
  return into;
}

function reference(into: Map<string, PathReference>, path: string): PathReference {
  let ref = into.get(path);
  if (!ref) {
    ref = { path, types: new Set(), comparedWith: new Set(), literalValues: new Set() };
    into.set(path, ref);
  }
  return ref;
}

function walk(node: Node, into: Map<string, PathReference>, usage: InferredType | null): void {
  switch (node.kind) {
    case 'literal':
      return;
    case 'path':
      if (node.root === 'applicant') {
        reference(into, pathString(node)).types.add(usage ?? 'unknown');
      }
      return;
    case 'unary':
      walk(node.operand, into, node.operator === '!' ? 'boolean' : 'number');
      return;
    case 'arithmetic':
      walk(node.left, into, 'number');
      walk(node.right, into, 'number');
      return;
    case 'logical':
      walk(node.left, into, 'boolean');
      walk(node.right, into, 'boolean');
      return;
    case 'conditional':
      walk(node.test, into, 'boolean');
      walk(node.consequent, into, usage);
      walk(node.alternate, into, usage);
      return;
    case 'comparison': {
      const numeric = ['<', '<=', '>', '>='].includes(node.operator);
      const textual = node.operator === 'matches';
      let leftUsage: InferredType | null = numeric ? 'number' : textual ? 'text' : null;
      let rightUsage: InferredType | null = numeric ? 'number' : null;
      if (node.operator === '==' || node.operator === '!=') {
        leftUsage = literalType(node.right) ?? null;
        rightUsage = literalType(node.left) ?? null;
      }
      walk(node.left, into, leftUsage);
      walk(node.right, into, rightUsage);
      link(node.left, node.right, into);
      link(node.right, node.left, into);
      return;
    }
  }
}

function literalType(node: Node): InferredType | undefined {
  if (node.kind !== 'literal' || node.value === null) return undefined;
  if (typeof node.value === 'number') return 'number';
  if (typeof node.value === 'boolean') return 'boolean';
  return 'text';
}

function link(from: Node, to: Node, into: Map<string, PathReference>): void {
  if (from.kind !== 'path' || from.root !== 'applicant') return;
  const ref = reference(into, pathString(from));
  if (to.kind === 'path' && to.root === 'params') ref.comparedWith.add(pathString(to));
  if (to.kind === 'literal' && typeof to.value === 'string') ref.literalValues.add(to.value);
}
