// Profile card overlay: the card from the Profile page, drawn over the game. Click-through.
const $ = (id) => document.getElementById(id);

function configure(cfg) {
  const p = cfg.profile || {};
  document.body.classList.toggle('edit', !!cfg.edit);
  $('stage').style.transform = `scale(${(cfg.size || 100) / 100})`;
  const pic = $('pic');
  pic.style.backgroundImage = p.avatar ? `url("${p.avatar}")` : 'none';
  pic.textContent = p.avatar ? '' : (p.name || '?').trim().charAt(0).toUpperCase() || '?';
  $('name').textContent = p.name || 'Your name';
  $('title').textContent = p.title || '';
  $('title').style.color = p.titleColor || '#00d8c8';
  $('title').style.textShadow = p.glow ? `0 0 12px ${p.titleColor || '#00d8c8'}` : 'none';
  $('rank').textContent = p.rank || '';
}

window.openw.on('overlay-config', configure);
window.openw.call('overlayConfig', 'card').then(configure);
