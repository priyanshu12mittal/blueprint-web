import { describe, it, expect } from 'vitest';

describe('diagram-model smoke test', () => {
  it('runs independently in vitest without Angular dependencies', () => {
    expect(1 + 1).toBe(2);
  });
});
