// La page d'état du gardien : qui a la carte graphique, qui attend, et le bouton du mode jeu.
// Elle s'ouvre sur le PC (http://localhost:7870) ou sur le téléphone avec --reseau.
export const PAGE = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>Gardien de la carte graphique</title>
<style>
  :root { --abyss: #060a14; --card: #111a2f; --card2: #18233d; --line: rgba(255,255,255,.12); --text: #f2f4fa; --soft: #b9c1d6; --mute: #8590ac; --accent: #f2a65a; --mint: #63d9a4; --rose: #ff7d8c; --star: #ffd983; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; font: 600 16px/1.45 system-ui, "Segoe UI", sans-serif; color: var(--text);
    background: radial-gradient(circle at 10% 0%, rgba(59,79,168,.35), transparent 55%), linear-gradient(180deg, #0d1633, var(--abyss) 60%); }
  main { max-width: 760px; margin: 0 auto; padding: 28px 18px 48px; }
  h1 { font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); margin: 0 0 18px; }
  .etat { border-radius: 26px; padding: 26px; background: var(--card); border: 1px solid var(--line); display: grid; gap: 14px; }
  .etat .titre { font-size: 30px; font-weight: 800; line-height: 1.15; }
  .etat .detail { color: var(--soft); }
  .etat.libre { border-color: rgba(99,217,164,.5); } .etat.occupee { border-color: rgba(242,166,90,.55); } .etat.pause { border-color: rgba(255,217,131,.6); }
  button { font: inherit; font-weight: 800; font-size: 18px; border: 0; border-radius: 999px; padding: 16px 26px; cursor: pointer; }
  .jeu { background: linear-gradient(135deg, #ffc27a, #f2a65a, #ff8748); color: #2b1505; box-shadow: 0 10px 30px rgba(255,135,72,.35); }
  .reprendre { background: var(--card2); color: var(--text); border: 1px solid var(--line); }
  h2 { font-size: 13px; letter-spacing: .12em; text-transform: uppercase; color: var(--mute); margin: 30px 0 10px; }
  ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  li { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 12px 16px; display: flex; justify-content: space-between; gap: 12px; align-items: center; }
  li small { color: var(--mute); }
  .vide { color: var(--mute); font-weight: 600; }
  .ok { color: var(--mint); } .ko { color: var(--rose); }
  .barre { height: 8px; border-radius: 8px; background: rgba(255,255,255,.08); overflow: hidden; width: 120px; }
  .barre i { display: block; height: 100%; background: var(--accent); }
  footer { margin-top: 28px; color: var(--mute); font-size: 14px; }
</style>
</head>
<body>
<main>
  <h1>Gardien de la carte graphique</h1>
  <section id="etat" class="etat"><div class="titre">…</div></section>
  <h2>En attente</h2>
  <ul id="attente"></ul>
  <h2>Tâches Wan</h2>
  <ul id="taches"></ul>
  <h2>Services</h2>
  <ul id="services"></ul>
  <footer id="menage"></footer>
</main>
<script>
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const depuis = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? "à l'instant" : 'depuis ' + m + ' min'; };
async function post(path) { await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); refresh(); }
async function refresh() {
  let s;
  try { s = await (await fetch('/api/etat')).json(); } catch { $('#etat').innerHTML = '<div class="titre">Le gardien ne répond pas</div>'; return; }
  const c = s.carte, e = $('#etat');
  e.className = 'etat ' + c.etat;
  if (c.etat === 'pause') {
    e.innerHTML = '<div class="titre">🎮 Mode jeu</div><div class="detail">' + (c.pause.raison === 'jeu' ? esc(c.pause.detail) + ' tourne : la carte lui est réservée.' : 'La carte graphique est réservée.') + ' Les demandes attendent.</div><div><button class="reprendre" onclick="post(\\'/api/reprise\\')">Reprendre</button></div>';
  } else {
    const d = c.detenteur;
    e.innerHTML = (d ? '<div class="titre">🎨 Utilisée par ' + esc(d.client) + '</div><div class="detail">' + esc(d.motif || '') + ' · ' + depuis(d.depuis) + '</div>' : '<div class="titre">🟢 Libre</div><div class="detail">Aucun programme ne se sert de la carte graphique.</div>') + '<div><button class="jeu" onclick="post(\\'/api/pause\\')">🎮 Mode jeu</button></div>';
  }
  $('#attente').innerHTML = s.attente.length ? s.attente.map((r, i) => '<li><span>' + (i + 1) + '. ' + esc(r.client) + ' <small>' + esc(r.motif) + '</small></span><small>' + esc(r.priorite) + '</small></li>').join('') : '<li class="vide">Personne</li>';
  $('#taches').innerHTML = s.taches.length ? s.taches.map((t) => '<li><span>' + esc(t.client) + ' <small>' + esc(t.motif) + '</small></span>' + (t.etat === 'en_cours' ? '<span class="barre"><i style="width:' + Math.round(t.avancement * 100) + '%"></i></span>' : '<small class="' + (t.etat === 'echec' ? 'ko' : '') + '">' + esc(t.etat.replace('_', ' ')) + '</small>') + '</li>').join('') : '<li class="vide">Aucune</li>';
  $('#services').innerHTML = s.services.length ? s.services.map((v) => '<li><span>' + esc(v.nom) + '</span><small class="' + (v.ok ? 'ok' : '') + '">' + esc(v.detail) + '</small></li>').join('') : '<li class="vide">Aucun service à lancer à la demande</li>';
  $('#menage').textContent = (s.jeux.actif ? 'Mode jeu automatique activé. ' : '') + (s.menage ? 'Dernier ménage ' + depuis(s.menage.at).replace('depuis', 'il y a') + ' : ' + (s.menage.freed.length ? s.menage.freed.join(', ') : 'la carte était déjà libre') + '.' : '');
}
refresh();
setInterval(refresh, 2000);
</script>
</body>
</html>`;
