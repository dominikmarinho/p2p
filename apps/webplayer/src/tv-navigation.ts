export function enableTvNavigation(): void {
  if (!new URLSearchParams(location.search).has('tv')) return;
  document.documentElement.classList.add('tv-mode');
  document.addEventListener('keydown', (event) => {
    const active = document.activeElement as HTMLElement | null;
    if (event.key === 'Escape' || event.keyCode === 10009 || event.keyCode === 461) {
      event.preventDefault(); const video = document.querySelector('video');
      if (video && !video.paused) video.pause();
      document.querySelector<HTMLElement>('nav button.active')?.focus(); return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if ((active?.tagName === 'INPUT' || active?.tagName === 'SELECT') && ['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const options = [...document.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],video')].filter((entry) => entry.getClientRects().length && !entry.closest('[hidden]'));
    if (!active || !options.includes(active)) { options[0]?.focus(); event.preventDefault(); return; }
    const box = active.getBoundingClientRect(); const x = box.x + box.width / 2; const y = box.y + box.height / 2;
    const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'; const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    let target: HTMLElement | undefined; let score = Infinity;
    for (const candidate of options) {
      if (candidate === active) continue; const rect = candidate.getBoundingClientRect(); const dx = rect.x + rect.width / 2 - x; const dy = rect.y + rect.height / 2 - y;
      const forward = (horizontal ? dx : dy) * direction; if (forward <= 1) continue;
      const weight = forward + Math.abs(horizontal ? dy : dx) * 3;
      if (weight < score) { score = weight; target = candidate; }
    }
    if (target) { event.preventDefault(); target.focus(); target.scrollIntoView({ block: 'nearest' }); }
  });
}
