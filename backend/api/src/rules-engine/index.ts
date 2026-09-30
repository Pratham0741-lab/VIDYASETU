/**
 * Purpose-built rule expression engine. Rule `expr` strings are untrusted,
 * officer-edited content: they are tokenized and parsed by a small
 * recursive-descent parser for a fixed grammar and evaluated by a tree
 * walker. No eval, Function, vm or sandbox library is used anywhere.
 */
export * from './analysis';
export * from './ast';
export * from './errors';
export * from './evaluator';
export * from './explain';
export { parse, ROOT_IDENTIFIERS, FORBIDDEN_SEGMENTS, MAX_NESTING_DEPTH } from './parser';
export { MAX_EXPRESSION_LENGTH } from './tokenizer';
