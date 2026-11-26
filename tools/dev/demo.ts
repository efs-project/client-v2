// `pnpm demo`: a small, realistic dataset on this worktree's fresh dev chain, to click through.
// Everything is written through the SDK's own planners (planCreateFolder, planCreateFile,
// planTag, planDeny, planLabel), sent by anvil's unlocked accounts exactly as a wallet would send
// them. Nothing here builds an action or computes an id: the links printed come from the SDK too.
//
// Who:
// - Alice, anvil #0: the deployment's default view (its seed author), and the account to connect.
// - Bob, anvil #1, and Carol, anvil #2: other people, so rows and tags say whose they are.
//
// What:
// - The shared root: Guides/ (README.md, getting-started.txt, faq.md), Photos/ (README.md,
//   sunset.png) and Notes/ (todo.txt, ideas.txt), by Alice.
// - Two addresses: Alice's (profile.txt) and Bob's (about.txt, music/playlist.txt and
//   photos/evening.png by Bob, and welcome.txt that Alice left there: "yours" to Alice,
//   "0xf39F…'s" to anyone else).
// - Tags: photos/sunsets (a nested path) by Alice (sunset.png) and Bob (sunset.png and his
//   evening.png, a row from someone outside Alice's view); guides and notes/todo by Alice; the
//   one-word tag sunsets by Bob, so the word page lists two places. Carol tags getting-started.txt
//   at photos/sunsets, and Alice says "not this" there (Unfiltered shows "1 of 2 say it applies").
// - A label: Alice names photos/sunsets "Sunset photos" in English.

import { crc32, deflateSync } from 'node:zlib';

interface Chain {
  readonly rpcUrl: string;
  readonly deployment: Record<string, unknown>;
  readonly accounts: { readonly unlocked: readonly string[] };
}

export interface DemoLinks {
  readonly folder: string;
  readonly tag: string;
  readonly word: string;
  readonly address: string;
  readonly image: string;
  readonly alice: string;
  readonly bob: string;
}

type Planned = { readonly status: string; readonly parts?: unknown; readonly review?: unknown };

/** One JSON-RPC call to anvil. */
function rpcTo(url: string) {
  let id = 0;
  return async (method: string, params: readonly unknown[] = []): Promise<unknown> => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
    });
    const body = (await response.json()) as { result?: unknown; error?: { message: string } };
    if (body.error) throw new Error(`${method}: ${body.error.message}`);
    return body.result;
  };
}

/** A wallet over anvil for one unlocked account: anvil signs eth_sendTransaction for it. */
function anvilWallet(rpc: ReturnType<typeof rpcTo>, account: string) {
  return {
    async request({ method, params }: { method: string; params?: readonly unknown[] }) {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account];
        case 'eth_chainId':
          return rpc('eth_chainId');
        case 'eth_sendTransaction':
          return rpc(method, params ?? []);
        default:
          throw Object.assign(new Error(`the demo wallet does not support ${method}`), {
            code: 4200,
          });
      }
    },
  };
}

/**
 * A small PNG (an evening sky over the sea), made here so the demo needs no binary asset. `sunX`
 * moves the sun (0..1 across), so two people's photos differ.
 */
function sunsetPng(sunX = 0.5, width = 96, height = 64): Uint8Array {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const sky = y < height * 0.6;
      const t = sky ? y / (height * 0.6) : (y - height * 0.6) / (height * 0.4);
      const sun = Math.hypot(x - width * sunX, y - height * 0.58) < height * 0.16;
      const [r, g, b] = sun
        ? [255, 214, 120]
        : sky
          ? [255 - 60 * (1 - t), 120 + 80 * t, 90 + 40 * (1 - t)]
          : [40 + 30 * (1 - t), 60 + 20 * (1 - t), 110 + 40 * (1 - t)];
      raw.set(
        [r, g, b].map((v) => Math.round(v)),
        row + 1 + x * 3,
      );
    }
  }
  const chunk = (type: string, data: Uint8Array) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', new Uint8Array()),
    ]),
  );
}

const text = (s: string) => new TextEncoder().encode(s);

const GUIDES_README = `# Guides

Short guides to the File Browser. Everything here is stored on the chain, and every version is
kept.

- **getting-started.txt**: the five things to try first.
- **faq.md**: questions people ask.

Tagged *guides*.
`;

const GETTING_STARTED = `Getting started

1. Open a folder: its README shows in the Overview.
2. Open a file: it shows in the Preview, checked against the chain.
3. Edit a text file: Review, then one approval.
4. Open a tag (photos/sunsets) to see what people tagged there, and who.
5. Open an address to see what's placed there, and whose each entry is.
`;

const FAQ = `# Questions

**Who can change a file?** Only its author. Anyone else's edit is their own version, shown to
people whose view puts them first.

**Is anything deleted?** No. Removing takes a name out of a folder; the file and its history stay.

**What is a tag?** A public statement that something belongs under a path of words.
`;

const PHOTOS_README = `# Photos

A sunset, uploaded as an image. Its type comes from its bytes, never its name.

Tagged *photos/sunsets* by two people, and named "Sunset photos".
`;

/** Seeds the demo. Returns what to open. */
export async function seedDemo(
  chain: Chain,
  uiRoute: (link: string) => string,
): Promise<DemoLinks> {
  const [{ createEfs, link }, { createWriter, memoryJournal }, files, tags] = await Promise.all([
    import('@efs/sdk'),
    import('@efs/sdk/actions'),
    import('@efs/sdk/files'),
    import('@efs/sdk/tags'),
  ]);
  const rpc = rpcTo(chain.rpcUrl);
  const efs = createEfs({ rpcs: [chain.rpcUrl], deployment: chain.deployment as never });
  const root = (chain.deployment as { root: { directoryRecordId: string; principalId: string } })
    .root;
  const rootFolder = {
    kind: 'folder',
    directory: root.directoryRecordId,
    owner: root.principalId,
  } as import('@efs/sdk/files').FolderRef;

  const as = async (index: number) => {
    const account = chain.accounts.unlocked[index]?.toLowerCase();
    if (!account) throw new Error(`no anvil account #${index}`);
    const writer = await createWriter(efs, {
      authorizer: {
        kind: 'eip1193',
        profile: 'direct',
        provider: anvilWallet(rpc, account),
        account: account as never,
      },
      journal: memoryJournal(),
    });
    const lens = efs.lens.mineFirst(account as never);
    /** Sends a planned save to COMPLETE and returns its review. */
    const save = async <R>(step: string, plan: Planned): Promise<R> => {
      if (plan.status !== 'PLANNED' || !plan.parts) {
        throw new Error(`demo: ${step} was not planned (${plan.status})`);
      }
      const done = await writer.runSequence(plan.parts as never);
      if (done.state !== 'COMPLETE') throw new Error(`demo: ${step} ended ${done.state}`);
      return plan.review as R;
    };
    const folder = async (parent: import('@efs/sdk/files').ParentRef, name: string) =>
      (
        await save<{ created: import('@efs/sdk/files').FolderRef }>(
          `folder ${name}`,
          await files.planCreateFolder(efs, writer, { folder: parent, name, lens }),
        )
      ).created;
    const file = async (
      parent: import('@efs/sdk/files').ParentRef,
      name: string,
      content: Uint8Array,
      mediaType?: string,
    ) =>
      (
        await save<{ file: import('@efs/sdk/files').FileRef }>(
          `file ${name}`,
          await files.planCreateFile(efs, writer, {
            folder: parent,
            name,
            content,
            ...(mediaType ? { mediaType } : {}),
            lens,
          }),
        )
      ).file;
    const tag = async (words: readonly string[], targets: readonly { subject: string }[]) =>
      save(
        `tag ${words.join('/')}`,
        await tags.planTag(efs, writer, {
          topic: words,
          targets: targets.map((t) => ({ kind: 'file', subject: t.subject }) as never),
        }),
      );
    const deny = async (words: readonly string[], target: { subject: string }) =>
      save(
        `not this at ${words.join('/')}`,
        await tags.planDeny(efs, writer, {
          topic: words,
          targets: [{ kind: 'file', subject: target.subject } as never],
        }),
      );
    const label = async (words: readonly string[], lang: string, value: string) =>
      save(
        `label ${words.join('/')}`,
        await tags.planLabel(efs, writer, { topic: words, lang, text: value }),
      );
    return { account, folder, file, tag, deny, label };
  };

  const alice = await as(0);
  const bob = await as(1);
  const carol = await as(2);
  const home = (address: string) => ({ kind: 'home', address }) as import('@efs/sdk/files').HomeRef;

  // The shared root, by Alice.
  const guides = await alice.folder(rootFolder, 'Guides');
  await alice.file(guides, 'README.md', text(GUIDES_README));
  const started = await alice.file(guides, 'getting-started.txt', text(GETTING_STARTED));
  const faq = await alice.file(guides, 'faq.md', text(FAQ));
  const photos = await alice.folder(rootFolder, 'Photos');
  await alice.file(photos, 'README.md', text(PHOTOS_README));
  const sunset = await alice.file(photos, 'sunset.png', sunsetPng(), 'image/png');
  const notes = await alice.folder(rootFolder, 'Notes');
  const todo = await alice.file(notes, 'todo.txt', text('- Try the demo\n- Tag something\n'));
  await alice.file(notes, 'ideas.txt', text('A playlist tagged by mood.\n'));

  // Two addresses: Alice's, and Bob's with Alice's welcome note in it.
  await alice.file(home(alice.account), 'profile.txt', text('Alice. Writes the guides.\n'));
  await bob.file(home(bob.account), 'about.txt', text('Bob. Mostly music.\n'));
  const music = await bob.folder(home(bob.account), 'music');
  await bob.file(music, 'playlist.txt', text('1. Evening\n2. Tide\n3. Lanterns\n'));
  const bobPhotos = await bob.folder(home(bob.account), 'photos');
  const evening = await bob.file(bobPhotos, 'evening.png', sunsetPng(0.25), 'image/png');
  await alice.file(home(bob.account), 'welcome.txt', text('Welcome, Bob! (Alice)\n'));

  // Tags: a nested path by two people, plain tags, a stray tag and its "not this", a label.
  await alice.tag(['photos', 'sunsets'], [sunset]);
  await alice.tag(['guides'], [started, faq]);
  await alice.tag(['notes', 'todo'], [todo]);
  await bob.tag(['photos', 'sunsets'], [sunset, evening]);
  await bob.tag(['sunsets'], [sunset]);
  await carol.tag(['photos', 'sunsets'], [started]);
  await alice.deny(['photos', 'sunsets'], started);
  await alice.label(['photos', 'sunsets'], 'en', 'Sunset photos');

  const route = (target: Parameters<typeof link>[0]) => uiRoute(link(target));
  return {
    folder: route({ kind: 'object', subject: guides.directory as never }),
    tag: route({ kind: 'topic', segments: ['photos', 'sunsets'], words: ['photos', 'sunsets'] }),
    word: route({ kind: 'topic', segments: ['sunsets'], words: ['sunsets'] }),
    address: route({ kind: 'home', address: bob.account as never, names: [] }),
    image: route({ kind: 'object', subject: sunset.subject as never }),
    alice: alice.account,
    bob: bob.account,
  };
}
