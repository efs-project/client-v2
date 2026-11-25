import { describe, expect, it } from 'vitest';
import { hostingOf } from './hosting.ts';

const CID = 'bafybeigdyrztktx5b5m2y4sogf2hf5uq3k5knv5c5k2pvx7aq5ekhnoyu';

const at = (url: string) => {
  const u = new URL(url);
  return {
    protocol: u.protocol,
    host: u.host,
    hostname: u.hostname,
    pathname: u.pathname,
    hash: u.hash,
  };
};

describe('hostingOf', () => {
  it('an ordinary host, at the root or under a path prefix, is its own origin', () => {
    expect(hostingOf(at('https://efs.example/'))).toEqual({ shared: false });
    expect(hostingOf(at('https://example.github.io/efs/#/files'))).toEqual({ shared: false });
    // A CID subdomain is an isolated origin too.
    expect(hostingOf(at(`https://${CID}.ipfs.dweb.link/`))).toEqual({ shared: false });
  });

  it('a path gateway is shared; the same content on its own subdomain is the isolated copy', () => {
    expect(hostingOf(at(`https://dweb.link/ipfs/${CID}/deep/path/#/r/testnet/`))).toEqual({
      shared: true,
      namespace: 'ipfs',
      name: CID,
      isolated: `https://${CID}.ipfs.dweb.link/deep/path/#/r/testnet/`,
    });
    expect(hostingOf(at('https://ipfs.io/ipns/app.efs.example/'))).toEqual({
      shared: true,
      namespace: 'ipns',
      name: 'app.efs.example',
      isolated: 'https://app-efs-example.ipns.ipfs.io/',
    });
    expect(hostingOf(at('https://ipfs.io/ipns/my-app.eth/'))).toMatchObject({
      isolated: 'https://my--app-eth.ipns.ipfs.io/',
    });
  });

  it("derives no link it can't stand behind: a CIDv0, or an IP-address host", () => {
    expect(
      hostingOf(at('https://ipfs.io/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/')),
    ).toEqual({
      shared: true,
      namespace: 'ipfs',
      name: 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG',
    });
    expect(hostingOf(at(`http://127.0.0.1:8080/ipfs/${CID}/`))).toEqual({
      shared: true,
      namespace: 'ipfs',
      name: CID,
    });
  });

  it("the operator's configured copy wins", () => {
    expect(hostingOf(at(`http://127.0.0.1:8080/ipfs/${CID}/`), 'https://efs.example/')).toEqual({
      shared: true,
      namespace: 'ipfs',
      name: CID,
      isolated: 'https://efs.example/',
    });
  });
});
