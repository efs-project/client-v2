// The local dev chain's accounts, by persona name: the same twenty as v1's dev wallet, in the same
// order (contracts' packages/nextjs/utils/scaffold-eth/hardhatAccounts.ts). Anvil derives the same
// addresses from its default mnemonic. Names and addresses only: the chain signs for them (the
// first ten are unlocked; the rest are impersonated at start), so no key is ever handed out here.

export interface Persona {
  readonly name: string;
  readonly address: string;
}

export const PERSONAS: readonly Persona[] = [
  { name: 'Satoshi Nakamoto', address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' },
  { name: 'Hal Finney', address: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' },
  { name: 'Joseph Lubin', address: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' },
  { name: 'Wei Dai', address: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' },
  { name: 'David Chaum', address: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' },
  { name: 'Phil Zimmermann', address: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc' },
  { name: 'Adam Back', address: '0x976EA74026E726554dB657fA54763abd0C3a0aa9' },
  { name: 'Tim May', address: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955' },
  { name: 'Eric Hughes', address: '0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f' },
  { name: 'Julian Assange', address: '0xa0Ee7A142d267C1f36714E4a8F75612F20a79720' },
  { name: 'Vitalik Buterin', address: '0xBcd4042DE499D14e55001CcbB24a551F3b954096' },
  { name: 'Austin Griffith', address: '0x71bE63f3384f5fb98995898A86B02Fb2426c5788' },
  { name: 'Anthony Sassano', address: '0xFABB0ac9d68B0B445fB7357272Ff202C5651694a' },
  { name: 'Danny Ryan', address: '0x1CBd3b2770909D4e10f157cABC84C7264073C9Ec' },
  { name: 'Evan Van Ness', address: '0xdF3e18d64BC6A983f673Ab319CCaE4f1a57C7097' },
  { name: 'Edward Snowden', address: '0xcd3B766CCDd6AE721141F452C550Ca635964ce71' },
  { name: 'Tim Beiko', address: '0x2546BcD3c84621e976D8185a91A922aE77ECEc30' },
  { name: 'Dankrad Feist', address: '0xbDA5747bFD65F08deb54cb465eB87D40e51B197E' },
  { name: 'Justin Drake', address: '0xdD2FD4581271e230360230F9337D5c0430Bf44C0' },
  { name: 'James Carnley', address: '0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199' },
];

/** 10,000 ETH, as anvil gives its own accounts. */
const BALANCE = `0x${(10_000n * 10n ** 18n).toString(16)}`;

/**
 * Makes every persona able to send on the dev chain: the ones anvil unlocks are checked against
 * their addresses (same mnemonic); the rest are impersonated and funded. Returns the personas as
 * the config lists them, lowercase.
 */
export async function readyPersonas(
  rpcUrl: string,
  unlocked: readonly string[],
): Promise<readonly Persona[]> {
  let id = 0;
  const rpc = async (method: string, params: readonly unknown[]) => {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const body = (await response.json()) as { error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
  };
  const open = new Set(unlocked.map((a) => a.toLowerCase()));
  for (const [i, p] of PERSONAS.entries()) {
    const address = p.address.toLowerCase();
    if (i < unlocked.length && unlocked[i]?.toLowerCase() !== address) {
      throw new Error(`dev account #${i} is ${unlocked[i]}, not ${p.name}'s ${p.address}`);
    }
    if (open.has(address)) continue;
    await rpc('anvil_impersonateAccount', [address]);
    await rpc('anvil_setBalance', [address, BALANCE]);
  }
  return PERSONAS.map((p) => ({ name: p.name, address: p.address.toLowerCase() }));
}
