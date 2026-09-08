import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import notices from '../../../public/legal/notices.json';

const repositoryFile = (path: string) =>
  readFileSync(resolve(process.cwd(), '../..', path), 'utf8');

describe('bundled Glossa legal notices', () => {
  it('preserves the unmodified upstream AGPL license', () => {
    const license = repositoryFile('LICENSE');
    expect(createHash('sha256').update(license).digest('hex')).toBe(
      '57c8ff33c9c0cfc3ef00e650a1cc910d7ee479a8bc509f6c9209a7c2a11399d6',
    );
    expect(notices.license).toBe(license);
  });

  it('ships the current modification notice and upstream acknowledgements offline', () => {
    expect(notices.notice).toBe(repositoryFile('NOTICE'));
    expect(notices.thirdParty).toBe(repositoryFile('THIRD_PARTY_NOTICES.md'));
  });
});
