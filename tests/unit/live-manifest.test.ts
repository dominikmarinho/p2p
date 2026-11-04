import { expect, it } from 'vitest';
import { IptvService } from '../../src/modules/iptv/iptv.service.js';
const service = { redis: { pipeline: () => ({}) } } as unknown as IptvService;
const manifest = '#EXTM3U\n#EXT-X-TARGETDURATION:11\n';
it('anuncia o mesmo atraso de quatro segmentos aos players Web e Android', async () => {
  expect(await IptvService.prototype.rewriteManifest.call(service, manifest, new URL('https://origin.test/'), 'grant', 'playlist', true)).toContain('#EXT-X-SERVER-CONTROL:HOLD-BACK=44');
});
it('preserva atributos de servidor e substitui HOLD-BACK sem duplicação', async () => {
  const text = manifest + '#EXT-X-SERVER-CONTROL:HOLD-BACK=33,CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=3\n';
  const result = await IptvService.prototype.rewriteManifest.call(service, text, new URL('https://origin.test/'), 'grant', 'playlist', true);
  expect(result).toContain('CAN-BLOCK-RELOAD=YES,PART-HOLD-BACK=3,HOLD-BACK=44'); expect(result).not.toContain('HOLD-BACK=33');
});
it('não alinha VOD, playlists finais ou metadados inválidos', async () => {
  for (const [text, live] of [[manifest, false], [manifest + '#EXT-X-ENDLIST', true], ['#EXTM3U\n#EXT-X-TARGETDURATION:bad\n', true]] as const) expect(await IptvService.prototype.rewriteManifest.call(service, text, new URL('https://origin.test/'), 'grant', 'playlist', live)).toBe(text);
});
