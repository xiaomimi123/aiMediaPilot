import { describe, expect, it } from 'vitest';
import { PersonaSchema, EMPTY_PERSONA } from '@/lib/persona/schema';

describe('PersonaSchema', () => {
  it('accepts a persona with empty lists', () => {
    expect(PersonaSchema.parse({ audience: 'x', pillars: [], painPoints: [], offerings: [] })).toMatchObject({ audience: 'x', angle: '', pillars: [] });
  });
  it('fills defaults for missing fields (old data)', () => {
    expect(PersonaSchema.parse({})).toEqual(EMPTY_PERSONA);
  });
  it('maps unknown offering types to other', () => {
    const p = PersonaSchema.parse({ offerings: [{ name: 'A', type: 'membership', targetPain: '', description: '' }] });
    expect(p.offerings[0].type).toBe('other');
  });
  it('rejects a pillar without a name', () => {
    expect(PersonaSchema.safeParse({ pillars: [{ name: '', description: 'x' }] }).success).toBe(false);
  });
});
