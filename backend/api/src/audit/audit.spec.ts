import { createHash } from 'node:crypto';
import { prismaAuditSource } from './audit-source';
import {
  AuditRowText,
  AuditSource,
  denialEnvelopeOf,
  denialLegacyDigest,
  DenialRowText,
  envelopeOf,
  legacyDigest,
  verifyAuditChain,
} from './audit-chain';
import {
  canonicalize,
  canonicalNumber,
  canonicalString,
  compareCodePoints,
  JsonNumber,
  parseJson,
} from './canonical';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

describe('canonical JSON (the audit hashing rules)', () => {
  it.each([
    ['0', '0'],
    ['-0.0', '0'],
    ['100', '100'],
    ['1.50', '1.5'],
    ['12.3400', '12.34'],
    ['1e21', '1000000000000000000000'],
    ['1.5e-7', '0.00000015'],
    ['-2.5E+2', '-250'],
    ['0.000', '0'],
    ['9007199254740993', '9007199254740993'],
    ['123456789012345678.1234567890', '123456789012345678.123456789'],
  ])('number %s -> %s (no float, no exponent)', (lexeme, out) => {
    expect(canonicalNumber(lexeme)).toBe(out);
  });

  it('escapes only \\, " and U+0000-U+001F; everything else is literal', () => {
    expect(canonicalString('a"b\\c')).toBe('"a\\"b\\\\c"');
    expect(canonicalString('line\nbreak\ttab\u0001')).toBe('"line\\u000abreak\\u0009tab\\u0001"');
    expect(canonicalString('आय / ✓ 😀  ')).toBe('"आय / ✓ 😀  "');
  });

  it('sorts keys by code point, not UTF-16 unit', () => {
    const keys = ['b', 'a', 'Z', 'é', '😀', '￿'];
    expect([...keys].sort(compareCodePoints)).toEqual(['Z', 'a', 'b', 'é', '￿', '😀']);
    // JavaScript's default sort puts the surrogate pair first - the reason
    // compareCodePoints exists (Postgres COLLATE "C" orders by code point).
    expect([...keys].sort()).not.toEqual(['Z', 'a', 'b', 'é', '￿', '😀']);
  });

  it('is independent of how the JSON was formatted (jsonb text, row_to_json text)', () => {
    const rowToJson = '{"id":"x","amount":1.50,"big":1e+21,"nested":{"b":[1,2.0],"a":null}}';
    const jsonb =
      '{"id": "x", "big": 1000000000000000000000, "amount": 1.50, "nested": {"a": null, "b": [1, 2.0]}}';
    const expected =
      '{"amount":1.5,"big":1000000000000000000000,"id":"x","nested":{"a":null,"b":[1,2]}}';
    expect(canonicalize(parseJson(rowToJson))).toBe(expected);
    expect(canonicalize(parseJson(jsonb))).toBe(expected);
  });

  it('parses escapes and rejects malformed or duplicate-key JSON', () => {
    expect(parseJson('"\\u0041\\n\\ud83d\\ude00"')).toBe('A\n😀');
    expect(() => parseJson('{"a":1,"a":2}')).toThrow(/duplicate/);
    expect(() => parseJson('{"a":01}')).toThrow();
    expect(() => parseJson('[1,]')).toThrow();
    expect(parseJson('12.50')).toEqual(new JsonNumber('12.50'));
  });
});

/** Writes chain rows by the same rules as audit_chain_append (for tests). */
function writeChain(entries: Array<{ action: string; row: string }>): AuditRowText[] {
  const rows: AuditRowText[] = [];
  let prev: string | null = null;
  entries.forEach((e, i) => {
    const r: AuditRowText = {
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      seq: String(i + 1),
      hash_version: 2,
      table_name: i === 0 ? 'audit_logs' : 'applications',
      record_id: '11111111-1111-4111-8111-111111111111',
      action: e.action,
      actor_id: null,
      actor_user_id: null,
      actor_type: null,
      actor_role: 'SYSTEM',
      ip_address: null,
      row_data: e.row,
      prev_hash: prev,
      record_hash: '',
      hash_input: null,
      created_at_us: String(1790000000000000 + i),
    };
    r.hash_input = canonicalize(envelopeOf(r));
    r.record_hash = sha256(r.hash_input);
    prev = r.record_hash;
    rows.push(r);
  });
  return rows;
}

const legacyRows: AuditRowText[] = [
  {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    seq: null,
    hash_version: null,
    table_name: 'schemes',
    record_id: '22222222-2222-4222-8222-222222222222',
    action: 'INSERT',
    actor_id: null,
    actor_user_id: null,
    actor_type: null,
    actor_role: null,
    ip_address: null,
    row_data: '{"code": "NOS", "amount": 1.50}',
    prev_hash: null,
    record_hash: 'f'.repeat(64),
    hash_input: null,
    created_at_us: '1780000000000000',
  },
];

function page<R extends { seq: string | null }>(rows: R[], after: string, limit: number) {
  return Promise.resolve(
    rows
      .filter((r) => BigInt(r.seq!) > BigInt(after))
      .sort((a, b) => Number(BigInt(a.seq!) - BigInt(b.seq!)))
      .slice(0, limit),
  );
}

function source(
  chain: AuditRowText[],
  legacy = legacyRows,
  head?: { last_seq: string; last_hash: string | null },
  denials: { chain: DenialRowText[]; legacy: DenialRowText[] } = { chain: [], legacy: [] },
): AuditSource {
  return {
    denialLegacyRows: () => Promise.resolve(denials.legacy),
    denialChainPage: (after, limit) => page(denials.chain, after, limit),
    denialHead: () =>
      Promise.resolve(
        denials.chain.length
          ? {
              last_seq: denials.chain[denials.chain.length - 1].seq!,
              last_hash: denials.chain[denials.chain.length - 1].record_hash,
            }
          : { last_seq: '0', last_hash: null },
      ),
    legacyRows: () => Promise.resolve(legacy),
    chainPage: (after, limit) =>
      Promise.resolve(
        chain
          .filter((r) => BigInt(r.seq!) > BigInt(after))
          .sort((a, b) => Number(BigInt(a.seq!) - BigInt(b.seq!)))
          .slice(0, limit),
      ),
    head: () =>
      Promise.resolve(
        head ?? {
          last_seq: chain[chain.length - 1].seq!,
          last_hash: chain[chain.length - 1].record_hash,
        },
      ),
  };
}

function validChain(legacyDenials: DenialRowText[] = []): AuditRowText[] {
  const checkpoint = JSON.stringify({
    kind: 'LEGACY_CHECKPOINT',
    legacy_rows: 1,
    legacy_digest: legacyDigest(legacyRows),
  });
  const denialsCheckpoint = JSON.stringify({
    kind: 'DENIALS_LEGACY_CHECKPOINT',
    legacy_rows: legacyDenials.length,
    legacy_digest: denialLegacyDigest(legacyDenials),
  });
  return writeChain([
    { action: 'CHECKPOINT', row: checkpoint },
    { action: 'INSERT', row: '{"id": "a", "current_stage": "SUBMITTED", "amount": 41000}' },
    { action: 'UPDATE', row: '{"id": "a", "current_stage": "INO_VERIFIED", "amount": 41000}' },
    { action: 'UPDATE', row: '{"id": "a", "current_stage": "DNO_VERIFIED", "amount": 41000.0}' },
    { action: 'CHECKPOINT', row: denialsCheckpoint },
  ]);
}

/** Writes denial chain rows by the same rules as record_authorization_denial. */
function writeDenials(n: number): DenialRowText[] {
  const rows: DenialRowText[] = [];
  let prev: string | null = null;
  for (let i = 0; i < n; i++) {
    const r: DenialRowText = {
      id: `dddddddd-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      seq: String(i + 1),
      hash_version: 2,
      prev_hash: prev,
      record_hash: '',
      hash_input: null,
      occurred_at_us: String(1790000000000100 + i),
      actor_user_id: 'a0000000-0000-4000-8000-000000000001',
      actor_id: null,
      actor_type: 'APPLICANT',
      actor_role: 'APPLICANT',
      action_attempted: 'POST /api/v1/applications/:id/verify',
      subject_type: 'application',
      subject_id: '5b0f8a3e-2a1c-4d8b-9e7f-0a1b2c3d4e5f',
      denial_reason: 'ROLE_NOT_PERMITTED',
      details: '{"required_roles": ["MINISTRY_OFFICER"]}',
      jurisdiction_state: 'Jharkhand',
      jurisdiction_district: 'Ranchi',
      jurisdiction_source: 'SUBJECT',
      ip_address: null,
      request_id: `req-${i}`,
    };
    r.hash_input = canonicalize(denialEnvelopeOf(r));
    r.record_hash = sha256(r.hash_input);
    prev = r.record_hash;
    rows.push(r);
  }
  return rows;
}

describe('verifyAuditChain', () => {
  it('passes an intact chain and reports legacy rows against the checkpoint', async () => {
    const r = await verifyAuditChain(source(validChain()), { pageSize: 2 });
    expect(r.ok).toBe(true);
    expect(r.first_break).toBeNull();
    expect(r.chain).toMatchObject({ rows: 5, first_seq: '1', last_seq: '5' });
    expect(r.denials).toMatchObject({
      ok: true,
      chain: { rows: 0 },
      legacy: { rows: 0, matches_checkpoint: true },
    });
    expect(r.legacy).toMatchObject({ rows: 1, checkpoint_rows: 1, matches_checkpoint: true });
  });

  it('names an edited row (CONTENT_MISMATCH, with the field)', async () => {
    const chain = validChain();
    chain[2] = {
      ...chain[2],
      row_data: '{"id": "a", "current_stage": "REJECTED", "amount": 41000}',
    };
    const r = await verifyAuditChain(source(chain));
    expect(r.ok).toBe(false);
    expect(r.first_break).toMatchObject({
      kind: 'CONTENT_MISMATCH',
      seq: '3',
      record_id: chain[2].id,
      fields: ['row_data'],
    });
  });

  it('names the row after a deleted one (SEQUENCE_GAP)', async () => {
    const chain = validChain();
    chain.splice(1, 1);
    const r = await verifyAuditChain(source(chain));
    expect(r.first_break).toMatchObject({ kind: 'SEQUENCE_GAP', seq: '3', record_id: chain[1].id });
    expect(r.first_break!.detail).toBe('expected seq 2, found 3');
  });

  it('detects a relinked row (LINK_MISMATCH) even when its own hash was recomputed', async () => {
    const chain = validChain();
    const r3 = { ...chain[3], prev_hash: chain[1].record_hash };
    r3.hash_input = canonicalize(envelopeOf(r3));
    r3.record_hash = sha256(r3.hash_input);
    chain[3] = r3;
    const r = await verifyAuditChain(source(chain));
    expect(r.first_break).toMatchObject({ kind: 'LINK_MISMATCH', seq: '4', record_id: r3.id });
  });

  it('detects a replaced record_hash (HASH_MISMATCH)', async () => {
    const chain = validChain();
    chain[1] = { ...chain[1], record_hash: '0'.repeat(64) };
    const r = await verifyAuditChain(source(chain));
    expect(r.first_break).toMatchObject({ kind: 'HASH_MISMATCH', seq: '2' });
  });

  it('detects a hash_input that is not canonical (writer/verifier disagreement)', async () => {
    const chain = validChain();
    const bad = chain[1].hash_input!.replace('{', '{ ');
    chain[1] = { ...chain[1], hash_input: bad, record_hash: sha256(bad) };
    const r = await verifyAuditChain(source(chain));
    expect(r.first_break).toMatchObject({ kind: 'NOT_CANONICAL', seq: '2' });
  });

  it('detects a changed legacy set and a truncated tail', async () => {
    const chain = validChain();
    const edited = [{ ...legacyRows[0], row_data: '{"code": "NOS", "amount": 2}' }];
    const r1 = await verifyAuditChain(source(chain, edited));
    expect(r1.ok).toBe(false);
    expect(r1.first_break).toBeNull();
    expect(r1.legacy.matches_checkpoint).toBe(false);

    const r2 = await verifyAuditChain(
      source(chain.slice(0, 3), legacyRows, { last_seq: '4', last_hash: chain[3].record_hash }),
    );
    expect(r2.first_break).toMatchObject({ kind: 'HEAD_MISMATCH', seq: '3' });
  });

  it('verifies the denials chain by the same rules and names a tampered denial', async () => {
    const legacyDenial = { ...writeDenials(1)[0], seq: null, hash_version: null, hash_input: null };
    const denials = writeDenials(3);
    const chain = validChain([legacyDenial]);
    const ok = await verifyAuditChain(
      source(chain, legacyRows, undefined, { chain: denials, legacy: [legacyDenial] }),
    );
    expect(ok.ok).toBe(true);
    expect(ok.denials).toMatchObject({
      ok: true,
      chain: { rows: 3, last_seq: '3' },
      legacy: { rows: 1, matches_checkpoint: true },
    });

    const edited = denials.map((d, i) =>
      i === 1 ? { ...d, denial_reason: 'OUT_OF_JURISDICTION' } : d,
    );
    const r1 = await verifyAuditChain(
      source(chain, legacyRows, undefined, { chain: edited, legacy: [legacyDenial] }),
    );
    expect(r1.ok).toBe(false);
    expect(r1.first_break).toBeNull();
    expect(r1.denials.first_break).toMatchObject({
      kind: 'CONTENT_MISMATCH',
      seq: '2',
      record_id: denials[1].id,
      fields: ['denial_reason'],
    });

    const r2 = await verifyAuditChain(
      source(chain, legacyRows, undefined, {
        chain: [denials[0], denials[2]],
        legacy: [legacyDenial],
      }),
    );
    expect(r2.denials.first_break).toMatchObject({ kind: 'SEQUENCE_GAP', seq: '3' });

    const r3 = await verifyAuditChain(
      source(chain, legacyRows, undefined, { chain: denials, legacy: [] }),
    );
    expect(r3.denials.legacy.matches_checkpoint).toBe(false);
  });

  it('requires the checkpoint at seq 1', async () => {
    const chain = writeChain([{ action: 'INSERT', row: '{"id": "a"}' }]);
    const r = await verifyAuditChain(source(chain));
    expect(r.first_break).toMatchObject({ kind: 'CHECKPOINT_MISSING', seq: '1' });
  });
});

describe('prismaAuditSource denial reads (Phase 13C, M36)', () => {
  function recorder() {
    const sql: string[] = [];
    const client = {
      $queryRawUnsafe: (q: string) => {
        sql.push(q);
        return Promise.resolve([]);
      },
    } as unknown as Parameters<typeof prismaAuditSource>[0];
    return { sql, client };
  }

  it('the api mode reads denials only through audit_verifier_denial_rows()', async () => {
    const { sql, client } = recorder();
    const source = prismaAuditSource(client, { denials: 'verifier-function' });
    await source.denialLegacyRows();
    await source.denialChainPage('0', 10);
    expect(sql[0]).toContain("audit_verifier_denial_rows('legacy'");
    expect(sql[1]).toContain("audit_verifier_denial_rows('chain'");
    expect(sql.join(' ')).not.toContain('FROM authorization_denials');
  });

  it('the CLI mode (owner connection) reads the table directly', async () => {
    const { sql, client } = recorder();
    const source = prismaAuditSource(client);
    await source.denialLegacyRows();
    await source.denialChainPage('0', 10);
    expect(sql.every((q) => q.includes('FROM authorization_denials d'))).toBe(true);
  });
});
