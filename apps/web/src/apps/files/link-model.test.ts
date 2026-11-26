import { describe, expect, it } from 'vitest';
import { checkLocator, fingerprint, hex, isHttps } from './link-model.ts';

describe('a linked file: its address as typed, and its fingerprint made here', () => {
  it('accepts ipfs://, ar:// and https:// addresses with something after the scheme', () => {
    expect(checkLocator('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi')).toBe(
      'ok',
    );
    expect(checkLocator('ar://bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U')).toBe('ok');
    expect(checkLocator('HTTPS://files.example.org/talk.mp4')).toBe('ok');
  });

  it('says what is wrong: nothing yet, another scheme, a bare scheme, or spaces and non-ASCII', () => {
    expect(checkLocator('')).toBe('empty');
    expect(checkLocator('http://files.example.org/a')).toBe('scheme');
    expect(checkLocator('ftp://x')).toBe('scheme');
    expect(checkLocator('ipfs://')).toBe('scheme');
    expect(checkLocator('https://example.org/my file.mp4')).toBe('chars');
    expect(checkLocator('https://exämple.org/a')).toBe('chars');
  });

  it('checks each kind of id by its shape: a CID, an Arweave id, a web address with a host', () => {
    expect(checkLocator('ipfs://QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG')).toBe('ok');
    expect(
      checkLocator('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi/talk.mp4'),
    ).toBe('ok');
    expect(checkLocator('ipfs://not-a-cid')).toBe('shape');
    expect(checkLocator('ar://too-short')).toBe('shape');
    expect(checkLocator('https://localhost/a')).toBe('shape');
    expect(checkLocator('https://user:pass@example.org/a')).toBe('shape');
  });

  it('names web addresses (fetched only where readers allow the site)', () => {
    expect(isHttps('https://example.org/a')).toBe(true);
    expect(isHttps('ipfs://bafy')).toBe(false);
  });

  it('fingerprints with SHA-256 as 0x-prefixed lowercase hex, with the exact length', async () => {
    const abc = new TextEncoder().encode('abc');
    expect(await fingerprint(abc)).toEqual({
      length: 3n,
      sha256: '0xba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
    expect(hex(new Uint8Array([0, 15, 255]))).toBe('0x000fff');
  });
});
