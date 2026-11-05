import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

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

// Dynamic concurrency must wake queued requests without restarting HLS.
const coreTarget = join(dirname(fileURLToPath(import.meta.resolve('p2p-media-loader-core'))), 'core.js');
const coreBefore = readFileSync(coreTarget, 'utf8');
if (!coreBefore.includes('highpass-dynamic-queue')) {
  const original = 'this.processSpecificDynamicConfigParams(secondaryStreamConfigCopy, dynamicConfig, "secondary");';
  if (!coreBefore.includes(original) || !coreBefore.includes('updateStream(streamRuntimeId, addSegments, removeSegmentIds)')) throw new Error('Revisar compatibilidade da fila de p2p-media-loader-core antes do build');
  writeFileSync(coreTarget, coreBefore.replace(original, original + '\n        // highpass-dynamic-queue\n        for (const streamId of this.streams.keys()) this.updateStream(streamId);'));
}

// Non-trickle SDP should not wait for an unrelated slow ICE server after TURN is usable.
const iceTarget = join(dirname(coreTarget), 'webtorrent/webtorrent-client/index.js');
const iceBefore = readFileSync(iceTarget, 'utf8');
const iceStart = '_WebTorrentClient_waitForIceGathering = function _WebTorrentClient_waitForIceGathering(pc) {';
const iceEnd = '}, _WebTorrentClient_waitForConnection = function';
if (!iceBefore.includes('highpass-useful-ice')) {
  const start = iceBefore.indexOf(iceStart); const end = iceBefore.indexOf(iceEnd, start);
  if (start < 0 || end < 0) throw new Error('Revisar compatibilidade da coleta ICE de p2p-media-loader-core antes do build');
  const replacement = iceStart + '\n    // highpass-useful-ice\n    return waitForUsefulIce(pc, __classPrivateFieldGet(this, _WebTorrentClient_config, "f").iceGatheringTimeout(), __classPrivateFieldGet(this, _WebTorrentClient_destroyAbortController, "f").signal);\n';
  writeFileSync(iceTarget, 'import { waitForUsefulIce } from "./highpass-ice-gathering.js";\n' + iceBefore.slice(0, start) + replacement + iceBefore.slice(end));
}
const { transpileModule, ScriptTarget, ModuleKind } = await import('typescript');
const iceSource = readFileSync(new URL('../apps/webplayer/src/p2p/ice-gathering.ts', import.meta.url), 'utf8');
writeFileSync(join(dirname(iceTarget), 'highpass-ice-gathering.js'), transpileModule(iceSource, { compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ES2022 } }).outputText);
