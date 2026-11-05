import { expect, it } from 'vitest';
import { selectedPeerPath } from '../../apps/webplayer/src/p2p/peer-path.js';
function stats(local: string, remote: string, selected = true) { return new Map<string, unknown>([['t', { type: 'transport', selectedCandidatePairId: selected ? 'pair' : undefined }], ['pair', { type: 'candidate-pair', nominated: selected, state: 'succeeded', localCandidateId: 'l', remoteCandidateId: 'r' }], ['l', { type: 'local-candidate', candidateType: local }], ['r', { type: 'remote-candidate', candidateType: remote }]]) as unknown as RTCStatsReport; }
it('classifica o par selecionado, incluindo relay do lado remoto', () => {
  expect(selectedPeerPath(stats('host', 'srflx'))).toBe('direct'); expect(selectedPeerPath(stats('relay', 'host'))).toBe('relay'); expect(selectedPeerPath(stats('host', 'relay'))).toBe('relay');
});
it('não confunde candidato disponível com caminho efetivamente selecionado', () => {
  expect(selectedPeerPath(stats('relay', 'host', false))).toBe('unknown'); expect(selectedPeerPath(new Map() as unknown as RTCStatsReport)).toBe('unknown');
});
