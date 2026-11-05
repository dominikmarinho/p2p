import { useState } from 'react';
import { clientLabel, clientTransport } from '../transport';

/** Safari installation has no programmatic install prompt. Never present a web app as a signed IPA. */
export function IosInstall() {
  const [visible, setVisible] = useState(() => new URLSearchParams(window.location.search).get('install') === 'ios');
  const [copied, setCopied] = useState(false);
  if (!visible || !clientTransport) return null;
  const url = new URL(`/player/${clientTransport}/`, window.location.origin).href;
  return <section className="ios-install" aria-label="Instalar no iPhone ou iPad"><div><small>IPHONE / IPAD · APLICATIVO WEB</small><h2>Instalar Highpass {clientLabel}</h2><p>No Safari do iPhone ou iPad:</p><ol><li>Abra o menu <strong>Compartilhar</strong>.</li><li>Escolha <strong>Adicionar à Tela de Início</strong>.</li><li>Se aparecer, ative <strong>Abrir como App</strong> e toque em <strong>Adicionar</strong>.</li></ol><p>O ícone abrirá o cliente {clientLabel}. Reprodução exige internet.{clientTransport === 'p2p' ? ' P2P requer iOS/iPadOS 17.1 ou posterior, WebRTC e suporte de mídia compatível. Não utiliza HTTP para vídeo; AirPlay fica desativado.' : ' Esta versão recebe vídeo por HTTP, sem WebRTC.'}</p><p>Esta instalação usa o Safari; não é um IPA ou download pela App Store.</p><div className="ios-actions"><button onClick={() => { void navigator.clipboard?.writeText(url).then(() => setCopied(true)).catch(() => setCopied(false)); }}>{copied ? 'Link copiado' : 'Copiar link para o iPhone'}</button><a href={url}>Continuar no player</a><button onClick={() => { setVisible(false); window.history.replaceState(null, '', window.location.pathname); }}>Fechar instruções</button></div></div></section>;
}
