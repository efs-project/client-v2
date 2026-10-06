// Build-only Vite plugin: records which source modules contributed code to each
// emitted chunk. Vite's manifest lists chunks, not contributing modules, so the
// startup-set and license checks read this file instead.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface ChunkRecord {
  fileName: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  modules: string[];
}

export interface Provenance {
  schema: 'efs-client-provenance/0-experimental';
  chunks: ChunkRecord[];
  assets: string[];
}

interface OutputChunkLike {
  type: 'chunk';
  fileName: string;
  isEntry: boolean;
  isDynamicEntry: boolean;
  imports: string[];
  dynamicImports: string[];
  moduleIds?: string[];
  modules?: Record<string, unknown>;
}
interface OutputAssetLike {
  type: 'asset';
  fileName: string;
}

export function provenance(options: { outFile: string }) {
  return {
    name: 'efs-provenance',
    apply: 'build' as const,
    generateBundle(_output: unknown, bundle: Record<string, OutputChunkLike | OutputAssetLike>) {
      const chunks: ChunkRecord[] = [];
      const assets: string[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type === 'asset') {
          assets.push(item.fileName);
          continue;
        }
        const modules = item.moduleIds ?? Object.keys(item.modules ?? {});
        chunks.push({
          fileName: item.fileName,
          isEntry: item.isEntry,
          isDynamicEntry: item.isDynamicEntry,
          imports: [...item.imports].sort(),
          dynamicImports: [...item.dynamicImports].sort(),
          modules: [...modules].sort(),
        });
      }
      chunks.sort((a, b) => a.fileName.localeCompare(b.fileName));
      const record: Provenance = {
        schema: 'efs-client-provenance/0-experimental',
        chunks,
        assets: assets.sort(),
      };
      mkdirSync(dirname(options.outFile), { recursive: true });
      writeFileSync(options.outFile, `${JSON.stringify(record, null, 2)}\n`);
    },
  };
}
