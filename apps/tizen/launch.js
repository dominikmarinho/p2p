(function () {
  try { if (window.tizen && window.tizen.tvinputdevice) window.tizen.tvinputdevice.registerKeyBatch(['MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop']); } catch (error) { console.info('Teclas padrão disponíveis', error.name); }
  window.location.replace('https://p2p.remoto.api.br/player/?tv=tizen');
}());
