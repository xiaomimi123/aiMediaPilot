import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const config = require('../../../next.config.js');

describe('old routes', () => {
  it('redirects /retro and /persona permanently', async () => {
    expect(await config.redirects()).toEqual([
      { source: '/retro', destination: '/works?stage=published', permanent: true },
      { source: '/persona', destination: '/settings#persona', permanent: true },
    ]);
  });
});
