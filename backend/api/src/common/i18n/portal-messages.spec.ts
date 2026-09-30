import { T } from '../../workflow/vidyasetu-workflow';
import { PORTAL_MESSAGES, portalMessage } from './portal-messages';

describe('portal message keys (Phase 17.2)', () => {
  it('English and Hindi have exactly the same keys, none empty', () => {
    expect(Object.keys(PORTAL_MESSAGES.hi).sort()).toEqual(Object.keys(PORTAL_MESSAGES.en).sort());
    for (const locale of ['en', 'hi'] as const) {
      for (const [k, v] of Object.entries(PORTAL_MESSAGES[locale])) {
        expect([locale, k, v.trim().length > 0]).toEqual([locale, k, true]);
      }
    }
  });

  it('every workflow trigger action has a history label', () => {
    for (const action of Object.values(T)) {
      expect(PORTAL_MESSAGES.en[`history.action.${action}`]).toBeDefined();
    }
  });

  it('every grievance status has an objection label', () => {
    for (const s of ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'REJECTED']) {
      expect(PORTAL_MESSAGES.en[`objection.status.${s}`]).toBeDefined();
    }
  });

  it('falls back to English, then to the key', () => {
    expect(portalMessage('history.action.verify', 'sat')).toBe(
      PORTAL_MESSAGES.en['history.action.verify'],
    );
    expect(portalMessage('no.such.key', 'hi')).toBe('no.such.key');
  });
});
