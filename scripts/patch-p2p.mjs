import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Compatibilidade do adaptador 4.0.0: init segments não pertencem ao catálogo
// P2P e playlists ao vivo podem remover um segmento enquanto o storage inicia.
const require = createRequire(import.meta.url);
const target = join(dirname(require.resolve('p2p-media-loader-hlsjs')), 'fragment-loader.js');
const before = readFileSync(target, 'utf8');
if (!before.includes('highpass-safe-fragment')) {
  const original = 'const isSegmentDownloadableByP2PCore = __classPrivateFieldGet(this, _FragmentLoaderBase_core, "f").isSegmentLoadable(__classPrivateFieldGet(this, _FragmentLoaderBase_segmentId, "f"));';
  const safe = '// highpass-safe-fragment\n        const isSegmentDownloadableByP2PCore = __classPrivateFieldGet(this, _FragmentLoaderBase_core, "f").hasSegment(__classPrivateFieldGet(this, _FragmentLoaderBase_segmentId, "f")) && __classPrivateFieldGet(this, _FragmentLoaderBase_core, "f").isSegmentLoadable(__classPrivateFieldGet(this, _FragmentLoaderBase_segmentId, "f"));';
  const promise = 'void __classPrivateFieldGet(this, _FragmentLoaderBase_core, "f").loadSegment(__classPrivateFieldGet(this, _FragmentLoaderBase_segmentId, "f"), { onSuccess, onError });';
  if (!before.includes(original) || !before.includes(promise)) throw new Error('Revisar compatibilidade da versão de p2p-media-loader-hlsjs antes do build');
  writeFileSync(target, before.replace(original, safe).replace(promise, promise.slice(0, -1) + '.catch(onError);'));
}
