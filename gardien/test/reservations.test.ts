import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_GAME_RULES, GameWatcher, findGame } from '../src/jeux.ts';
import { Scheduler } from '../src/reservations.ts';
import type { Reservation } from '../src/reservations.ts';

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('une seule réservation à la fois, par priorité puis par ordre d’arrivée', () => {
  const s = new Scheduler();
  const oula1 = s.request({ client: 'oula', priorite: 'basse' });
  const oula2 = s.request({ client: 'oula', priorite: 'basse' });
  const storia = s.request({ client: 'storia', priorite: 'haute' });
  assert.equal(oula1.etat, 'accordee'); // la carte était libre
  assert.deepEqual(s.waiting().map((r) => r.id), [storia.id, oula2.id]); // Storia passe devant, sans interrompre
  assert.equal(s.position(storia.id), 1);
  assert.equal(s.reason(oula2.id), 'est utilisée par oula, 1 demande avant toi');
  s.release(oula1.id);
  assert.equal(s.holder()?.id, storia.id);
  s.release(storia.id);
  assert.equal(s.holder()?.id, oula2.id);
});

test('un programme qui ne donne plus signe de vie perd la carte', () => {
  const c = clock();
  const s = new Scheduler({ leaseMs: 90_000, now: c.now });
  const lost = s.request({ client: 'oula' });
  const next = s.request({ client: 'storia' });
  const internal = s.request({ client: 'gardien', interne: true });
  c.advance(60_000);
  s.touch(next.id);
  c.advance(40_000);
  s.tick();
  assert.equal(s.get(lost.id), undefined);
  assert.equal(s.holder()?.id, next.id);
  s.release(next.id);
  c.advance(500_000);
  s.tick();
  assert.equal(s.holder()?.id, internal.id); // tenue par le gardien : jamais abandonnée
});

test('le mode jeu reprend la carte, et la tâche interrompue repasse devant', () => {
  const s = new Scheduler();
  const revoked: Reservation[] = [];
  s.on('revoke', (r: Reservation) => revoked.push(r));
  const first = s.request({ client: 'oula', priorite: 'basse' });
  const other = s.request({ client: 'oula', priorite: 'basse' });
  s.setPause({ raison: 'jeu', detail: 'eldenring.exe', depuis: 0 });
  assert.equal(first.etat, 'revoquee');
  assert.deepEqual(revoked.map((r) => r.id), [first.id]);
  assert.equal(s.holder(), null);
  assert.equal(s.reason(other.id), 'est réservée au jeu (eldenring.exe)');
  s.release(first.id);
  const again = s.request({ client: 'oula', priorite: 'basse', reprise: true });
  assert.equal(s.holder(), null); // rien n'est accordé pendant le jeu
  s.setPause(null);
  assert.equal(s.holder()?.id, again.id);
});

test('le ménage est fait avant de passer la carte à un autre programme, pas entre deux tâches du même', async () => {
  const switches: string[] = [];
  let finish!: () => void;
  const s = new Scheduler({
    beforeSwitch: (previous, next) => {
      switches.push(`${previous}→${next.client}`);
      return new Promise<void>((resolve) => (finish = resolve));
    },
  });
  const a = s.request({ client: 'storia' });
  s.request({ client: 'storia' });
  s.release(a.id);
  assert.equal(s.holder()?.client, 'storia'); // même programme : pas de ménage
  const b = s.holder() as Reservation;
  const oula = s.request({ client: 'oula' });
  s.release(b.id);
  assert.deepEqual(switches, ['storia→oula']);
  assert.equal(s.holder(), null); // la carte attend la fin du ménage
  finish();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.holder()?.id, oula.id);
  assert.equal(s.lastClient, null);
});

test('les jeux sont reconnus à leur dossier, sauf les lanceurs et les fonds d’écran', () => {
  const rules = { ...DEFAULT_GAME_RULES, executables: ['minecraft.exe'] };
  assert.equal(findGame(['C:\\Windows\\explorer.exe', 'D:\\SteamLibrary\\steamapps\\common\\ELDEN RING\\Game\\eldenring.exe'], rules), 'eldenring.exe');
  assert.equal(findGame(['C:\\Program Files (x86)\\Steam\\steamapps\\common\\wallpaper_engine\\wallpaper64.exe'], rules), null);
  assert.equal(findGame(['C:\\Program Files (x86)\\Epic Games\\Launcher\\Portal\\Binaries\\Win64\\EpicGamesLauncher.exe'], rules), null);
  assert.equal(findGame(['C:\\Program Files\\Epic Games\\Fortnite\\FortniteGame\\Binaries\\Win64\\FortniteClient-Win64-Shipping.exe'], rules), 'FortniteClient-Win64-Shipping.exe');
  assert.equal(findGame(['C:\\Users\\moi\\AppData\\Roaming\\.minecraft\\Minecraft.exe'], rules), 'Minecraft.exe');
  assert.equal(findGame(['C:\\Program Files\\Pinokio\\Pinokio.exe'], rules), null);
});

test('le mode jeu commence avec le jeu et finit un peu après lui', async () => {
  const c = clock();
  let running: string[] = [];
  const events: string[] = [];
  const w = new GameWatcher({ rules: DEFAULT_GAME_RULES, graceMs: 30_000, now: c.now, list: async () => running });
  w.on('debut', (g: string) => events.push(`début ${g}`));
  w.on('fin', (g: string) => events.push(`fin ${g}`));
  await w.scan();
  running = ['D:/SteamLibrary/steamapps/common/Hades/Hades.exe'];
  await w.scan();
  running = [];
  c.advance(10_000);
  await w.scan(); // le jeu redémarre peut-être : on attend encore
  c.advance(25_000);
  await w.scan();
  assert.deepEqual(events, ['début Hades.exe', 'fin Hades.exe']);
});
