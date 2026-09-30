/**
 * Generic workflow transition engine.
 *
 * Knows nothing about VIDYASETU: it consumes a WorkflowDefinition (states,
 * and per state the legal outbound transitions with the principals allowed
 * to trigger them and an optional guard) and decides one requested
 * transition. It never touches the database; the host persists the result.
 * The concrete graph lives in vidyasetu-workflow.ts, the same "generic
 * engine, one concrete instance" split as src/rules-engine and the seeded
 * scheme rules.
 */

/** Target of a transition that returns to the state the current one was entered from. */
export interface ReturnTarget<S extends string> {
  returnToOrigin: true;
  /** States it may legally return to; anything else is rejected. */
  allowed: readonly S[];
}

export type TransitionTarget<S extends string> = S | ReturnTarget<S>;

/** A guard returns null to allow, or a client-safe reason to reject. */
export type Guard<C> = (context: C) => string | null;

export interface TransitionDef<S extends string, P extends string, C> {
  to: TransitionTarget<S>;
  /** Principals (roles, or a system principal) allowed to trigger it. */
  by: readonly P[];
  guard?: Guard<C>;
  /** Opaque data for the host (decision codes, ...); never read by the engine. */
  meta?: Readonly<Record<string, string>>;
}

export interface StateDef<S extends string, P extends string, C> {
  /** Terminal states have no outbound transitions. */
  terminal?: boolean;
  /**
   * The state is left immediately on entry by the host running the named
   * resolver, which picks one of its transitions (e.g. an automatic gate).
   */
  automatic?: string;
  transitions: Readonly<Record<string, TransitionDef<S, P, C>>>;
  meta?: Readonly<Record<string, string>>;
}

export interface WorkflowDefinition<S extends string, P extends string, C> {
  name: string;
  initial: S;
  states: Readonly<Record<S, StateDef<S, P, C>>>;
}

export type WorkflowErrorKind =
  | 'UNKNOWN_STATE'
  | 'TERMINAL_STATE'
  | 'TRANSITION_NOT_ALLOWED'
  | 'PRINCIPAL_NOT_PERMITTED'
  | 'GUARD_REJECTED'
  | 'NO_RETURN_TARGET';

export class WorkflowError extends Error {
  constructor(
    readonly kind: WorkflowErrorKind,
    message: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export interface TransitionRequest<P extends string, C> {
  from: string;
  transition: string;
  principal: P;
  /** Guard input: facts about the subject and the request. */
  context: C;
  /** The state the current one was entered from (for return transitions). */
  enteredFrom?: string | null;
}

export interface TransitionDecision<S extends string, P extends string, C> {
  from: S;
  to: S;
  transition: string;
  def: TransitionDef<S, P, C>;
}

function isReturnTarget<S extends string>(to: TransitionTarget<S>): to is ReturnTarget<S> {
  return typeof to === 'object' && to !== null && to.returnToOrigin === true;
}

function hasState<S extends string, P extends string, C>(
  def: WorkflowDefinition<S, P, C>,
  state: string,
): state is S {
  return Object.prototype.hasOwnProperty.call(def.states, state);
}

/**
 * Decides one transition. Checks, in order: the current state exists, it is
 * not terminal, the transition is defined from it, the principal may trigger
 * it, the guard passes, and (for return transitions) the origin is allowed.
 * Throws WorkflowError on the first failure.
 */
export function decideTransition<S extends string, P extends string, C>(
  def: WorkflowDefinition<S, P, C>,
  request: TransitionRequest<P, C>,
): TransitionDecision<S, P, C> {
  const { from, transition, principal } = request;
  if (!hasState(def, from)) {
    throw new WorkflowError('UNKNOWN_STATE', `Unknown state "${from}".`, { state: from });
  }
  const state = def.states[from];
  if (state.terminal) {
    throw new WorkflowError('TERMINAL_STATE', `"${from}" is a final state.`, {
      state: from,
      transition,
    });
  }
  const t = Object.prototype.hasOwnProperty.call(state.transitions, transition)
    ? state.transitions[transition]
    : undefined;
  if (!t) {
    throw new WorkflowError(
      'TRANSITION_NOT_ALLOWED',
      `"${transition}" is not allowed from "${from}".`,
      { state: from, transition, allowed: Object.keys(state.transitions) },
    );
  }
  if (!t.by.includes(principal)) {
    throw new WorkflowError(
      'PRINCIPAL_NOT_PERMITTED',
      `"${principal}" may not "${transition}" from "${from}".`,
      { state: from, transition, permitted: [...t.by] },
    );
  }
  const reason = t.guard?.(request.context) ?? null;
  if (reason !== null) {
    throw new WorkflowError('GUARD_REJECTED', reason, { state: from, transition });
  }

  let to: S;
  if (isReturnTarget(t.to)) {
    const origin = request.enteredFrom ?? null;
    if (origin === null || !(t.to.allowed as readonly string[]).includes(origin)) {
      throw new WorkflowError(
        'NO_RETURN_TARGET',
        `"${transition}" cannot return from "${from}" to "${origin ?? 'unknown'}".`,
        { state: from, transition, origin },
      );
    }
    to = origin as S;
  } else {
    to = t.to;
  }
  return { from, to, transition, def: t };
}

/** States in which the principal can trigger at least one transition. */
export function statesActionableBy<S extends string, P extends string, C>(
  def: WorkflowDefinition<S, P, C>,
  principal: P,
): S[] {
  return (Object.keys(def.states) as S[]).filter((s) =>
    Object.values<TransitionDef<S, P, C>>(def.states[s].transitions).some((t) =>
      t.by.includes(principal),
    ),
  );
}

/** Structural problems in a definition (empty = valid). Run at load and in tests. */
export function validateDefinition<S extends string, P extends string, C>(
  def: WorkflowDefinition<S, P, C>,
): string[] {
  const problems: string[] = [];
  if (!hasState(def, def.initial))
    problems.push(`initial state "${String(def.initial)}" is not defined`);
  for (const [name, state] of Object.entries<StateDef<S, P, C>>(def.states)) {
    const transitions = Object.entries<TransitionDef<S, P, C>>(state.transitions);
    if (state.terminal && transitions.length > 0) {
      problems.push(`terminal state "${name}" has outbound transitions`);
    }
    if (!state.terminal && transitions.length === 0) {
      problems.push(`non-terminal state "${name}" has no outbound transitions`);
    }
    for (const [tName, t] of transitions) {
      const targets = isReturnTarget(t.to) ? t.to.allowed : [t.to];
      for (const target of targets) {
        if (!hasState(def, target)) {
          problems.push(`"${name}.${tName}" targets undefined state "${String(target)}"`);
        }
      }
      if (t.by.length === 0) problems.push(`"${name}.${tName}" has no permitted principal`);
    }
  }
  return problems;
}
