/** Non-trickle SDP: finish once a public/relay path exists, without dropping TURN on restrictive networks. */
export function waitForUsefulIce(pc: RTCPeerConnection, timeoutMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => finish(), timeoutMs);
    let settle: ReturnType<typeof setTimeout> | undefined;
    let done = false;
    const servers = pc.getConfiguration().iceServers ?? [];
    const needsRelay = servers.some((server) => (Array.isArray(server.urls) ? server.urls : [server.urls]).some((url) => /^turns?:/i.test(url)));
    const cleanup = () => { clearTimeout(deadline); clearTimeout(settle); pc.removeEventListener('icegatheringstatechange', changed); pc.removeEventListener('icecandidate', candidate); pc.removeEventListener('signalingstatechange', changed); signal.removeEventListener('abort', aborted); };
    const finish = (error?: Error) => { if (done) return; done = true; cleanup(); if (error) reject(error); else resolve(); };
    const aborted = () => finish(new Error('ICE gathering aborted due to teardown'));
    const useful = (type?: string) => {
      const sdp = pc.localDescription?.sdp ?? '';
      const available = needsRelay ? type === 'relay' || / typ relay(?:\s|$)/m.test(sdp) : type === 'srflx' || type === 'relay' || / typ (?:srflx|relay)(?:\s|$)/m.test(sdp) || servers.length === 0 && / typ host(?:\s|$)/m.test(sdp);
      // Keep a brief collection window for additional candidates/interfaces.
      if (available && !settle && !done) settle = setTimeout(() => finish(), 200);
    };
    const changed = () => { if (pc.signalingState === 'closed') finish(new Error('RTCPeerConnection closed')); else if (pc.iceGatheringState === 'complete') finish(); else useful(); };
    const candidate = (event: RTCPeerConnectionIceEvent) => { if (event.candidate === null) finish(); else useful(event.candidate.type ?? undefined); };
    if (signal.aborted) { aborted(); return; }
    pc.addEventListener('icegatheringstatechange', changed); pc.addEventListener('icecandidate', candidate); pc.addEventListener('signalingstatechange', changed); signal.addEventListener('abort', aborted);
    changed();
  });
}
