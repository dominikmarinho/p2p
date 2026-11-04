/** Shared by HLS.js and the Android bridge so cellular jitter does not reset a segment early. */
export const resilientP2P = {
  p2pNotReceivingBytesTimeoutMs: 10000,
  webRtcConnectionTimeoutMs: 25000,
  webRtcIceGatheringTimeoutMs: 8000,
  p2pDownloadTimeWindow: 60,
  webRtcMaxMessageSize: 16384,
};
export const exclusiveSegmentDeadlineMs = 45000;
