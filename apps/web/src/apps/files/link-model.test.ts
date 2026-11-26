import { describe, expect, it } from 'vitest';
import { checkLocator, fingerprint, hex, isHttps } from './link-model.ts';

describe('a linked file: its address as typed, and its fingerprint made here', () => {
  // The SDK's verdict, injected: here a stand-in that refuses whatever contains "bad".
  const sdk = (locator: string) => ({ ok: !locator.includes('bad') });

  it("accepts this feature's schemes once the SDK says the address could be read", () => {
    expect(
      checkLocator('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', sdk),
    ).toBe('ok');
    expect(checkLocator('ar://bNbA3TEQVL60xlgCcqdz4ZPHFZ711cZ3hmkpGttDt_U', sdk)).toBe('ok');
    expect(checkLocator('HTTPS://files.example.org/talk.mp4', sdk)).toBe('ok');
  });

  it('says what is wrong, in order: nothing yet, characters, another scheme, then the SDK', () => {
    expect(checkLocator('', sdk)).toBe('empty');
    expect(checkLocator('https://example.org/my file.mp4', sdk)).toBe('chars');
    expect(checkLocator('https://exämple.org/a', sdk)).toBe('chars');
    expect(checkLocator('http://files.example.org/a', sdk)).toBe('scheme');
    expect(checkLocator('web3://0xabc', sdk)).toBe('scheme');
    expect(checkLocator('ipfs://', sdk)).toBe('scheme');
    expect(checkLocator('ipfs://bad-cid', sdk)).toBe('shape');
  });

  it('is pending (no Review) until the SDK check has loaded', () => {
    expect(
      checkLocator('ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi', undefined),
    ).toBe('pending');
    expect(checkLocator('ftp://x', undefined)).toBe('scheme');
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
