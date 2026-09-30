import {
  decideTransition,
  statesActionableBy,
  validateDefinition,
  WorkflowDefinition,
  WorkflowError,
} from './engine';

// A toy definition with nothing VIDYASETU-specific: the engine must work for
// any graph it is given.
type S = 'draft' | 'review' | 'held' | 'done';
type P = 'author' | 'editor' | 'bot';
interface C {
  pages: number;
}

const DOC: WorkflowDefinition<S, P, C> = {
  name: 'doc/v1',
  initial: 'draft',
  states: {
    draft: { automatic: 'lint', transitions: { submit: { to: 'review', by: ['bot'] } } },
    review: {
      transitions: {
        approve: {
          to: 'done',
          by: ['editor'],
          guard: (c) => (c.pages > 0 ? null : 'empty document'),
        },
        hold: { to: 'held', by: ['editor'] },
      },
    },
    held: {
      transitions: {
        resume: { to: { returnToOrigin: true, allowed: ['review'] }, by: ['author'] },
      },
    },
    done: { terminal: true, transitions: {} },
  },
};

function kindOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    if (err instanceof WorkflowError) return err.kind;
    throw err;
  }
  return 'NO_ERROR';
}

describe('workflow engine (generic)', () => {
  it('accepts a valid definition', () => {
    expect(validateDefinition(DOC)).toEqual([]);
  });

  it('applies a permitted transition whose guard passes', () => {
    const d = decideTransition(DOC, {
      from: 'review',
      transition: 'approve',
      principal: 'editor',
      context: { pages: 3 },
    });
    expect([d.from, d.to, d.transition]).toEqual(['review', 'done', 'approve']);
  });

  it.each([
    ['UNKNOWN_STATE', { from: 'nowhere', transition: 'approve', principal: 'editor' }],
    ['TERMINAL_STATE', { from: 'done', transition: 'approve', principal: 'editor' }],
    ['TRANSITION_NOT_ALLOWED', { from: 'held', transition: 'approve', principal: 'editor' }],
    ['PRINCIPAL_NOT_PERMITTED', { from: 'review', transition: 'approve', principal: 'author' }],
    ['PRINCIPAL_NOT_PERMITTED', { from: 'draft', transition: 'submit', principal: 'editor' }],
  ])('rejects with %s', (kind, req) => {
    expect(kindOf(() => decideTransition(DOC, { ...req, context: { pages: 1 } }))).toBe(kind);
  });

  it('rejects when the guard fails, with the guard reason', () => {
    const run = () =>
      decideTransition(DOC, {
        from: 'review',
        transition: 'approve',
        principal: 'editor',
        context: { pages: 0 },
      });
    expect(kindOf(run)).toBe('GUARD_REJECTED');
    expect(run).toThrow('empty document');
  });

  it('resolves a return transition to the origin, only if that origin is allowed', () => {
    const base = {
      from: 'held',
      transition: 'resume',
      principal: 'author' as P,
      context: { pages: 1 },
    };
    expect(decideTransition(DOC, { ...base, enteredFrom: 'review' }).to).toBe('review');
    expect(kindOf(() => decideTransition(DOC, { ...base, enteredFrom: 'draft' }))).toBe(
      'NO_RETURN_TARGET',
    );
    expect(kindOf(() => decideTransition(DOC, { ...base, enteredFrom: null }))).toBe(
      'NO_RETURN_TARGET',
    );
  });

  it('does not treat inherited object keys as transitions', () => {
    expect(
      kindOf(() =>
        decideTransition(DOC, {
          from: 'review',
          transition: 'constructor',
          principal: 'editor',
          context: { pages: 1 },
        }),
      ),
    ).toBe('TRANSITION_NOT_ALLOWED');
  });

  it('lists the states a principal can act in', () => {
    expect(statesActionableBy(DOC, 'editor')).toEqual(['review']);
    expect(statesActionableBy(DOC, 'bot')).toEqual(['draft']);
  });

  it('reports structural problems', () => {
    const broken = {
      name: 'broken',
      initial: 'x',
      states: {
        a: { terminal: true, transitions: { go: { to: 'b', by: ['p'] } } },
        b: { transitions: {} },
        c: { transitions: { jump: { to: 'nowhere', by: [] } } },
      },
    } as unknown as WorkflowDefinition<string, string, unknown>;
    expect(validateDefinition(broken)).toEqual([
      'initial state "x" is not defined',
      'terminal state "a" has outbound transitions',
      'non-terminal state "b" has no outbound transitions',
      '"c.jump" targets undefined state "nowhere"',
      '"c.jump" has no permitted principal',
    ]);
  });
});
