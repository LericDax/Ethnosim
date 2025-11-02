import { describe, expect, it } from 'vitest';
import { createResourceBundle } from '../src/sim/engine/resources.ts';

describe('resource bundle creation', () => {
  it('normalizes missing resource entries to zero', () => {
    const bundle = createResourceBundle({});

    expect(bundle).toEqual({ wood: 0, forage: 0, ore: 0 });
  });
});
