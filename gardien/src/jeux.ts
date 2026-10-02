// Le mode jeu automatique : dès qu'un jeu tourne, la carte graphique lui est réservée.
// Un jeu est reconnu à son dossier (bibliothèques Steam, Epic, GOG, Xbox…) ou à son nom d'exécutable.
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';

export interface GameRules {
  /** Morceaux de chemin qui désignent un dossier de jeux. */
  dossiers: string[];
  /** Noms d'exécutables à traiter comme des jeux, où qu'ils soient (ex. « minecraft.exe »). */
  executables: string[];
  /** Morceaux de chemin à ne jamais compter comme des jeux (lanceurs, fonds d'écran animés…). */
  ignorer: string[];
}

export const DEFAULT_GAME_RULES: GameRules = {
  dossiers: [
    '/steamapps/common/',
    '/epic games/',
    '/gog galaxy/games/',
    '/gog games/',
    '/riot games/',
    '/xboxgames/',
    '/ea games/',
    '/ubisoft game launcher/games/',
    '/amazon games/library/',
  ],
  executables: [],
  ignorer: [
    '/epic games/launcher/',
    '/riot games/riot client/',
    '/steamapps/common/wallpaper_engine/', // tourne en permanence : ce n'est pas un jeu
    '/steamapps/common/steamworks shared/',
    '/steamapps/common/steamvr/',
  ],
};

const normalize = (p: string) => p.replace(/\\/g, '/').toLowerCase();

/** Le premier jeu trouvé parmi ces exécutables (son nom de fichier), ou null. */
export function findGame(paths: string[], rules: GameRules): string | null {
  const executables = rules.executables.map((e) => e.toLowerCase());
  const folders = rules.dossiers.map(normalize);
  const ignored = rules.ignorer.map(normalize);
  for (const raw of paths) {
    const p = normalize(raw);
    if (ignored.some((i) => p.includes(i))) continue;
    const name = p.slice(p.lastIndexOf('/') + 1);
    if (executables.includes(name) || folders.some((f) => p.includes(f))) return raw.replace(/^.*[\\/]/, '');
  }
  return null;
}

/** Chemins des programmes en cours, sous Windows (PowerShell, une fraction de seconde). */
export function listProcessPaths(): Promise<string[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const script = '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-Process | Where-Object Path | ForEach-Object { $_.Path }';
  return new Promise((resolve) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? [] : stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
    });
  });
}

export interface WatcherOptions {
  rules: GameRules;
  /** Intervalle entre deux regards (10 s). */
  intervalMs?: number;
  /** Le jeu doit avoir disparu depuis ce temps pour que la carte soit rendue (30 s) : un jeu qui redémarre ne fait pas tout repartir. */
  graceMs?: number;
  list?: () => Promise<string[]>;
  now?: () => number;
}

/** Surveille les jeux : émet « debut » (nom du jeu) quand un jeu démarre, « fin » quand il n'y en a plus. */
export class GameWatcher extends EventEmitter {
  current: string | null = null;
  private lastSeen = 0;
  private timer: NodeJS.Timeout | undefined;
  private scanning = false;
  private readonly o: WatcherOptions;

  constructor(o: WatcherOptions) {
    super();
    this.o = o;
  }

  start(): void {
    void this.scan();
    this.timer = setInterval(() => void this.scan(), this.o.intervalMs ?? 10_000);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      const now = (this.o.now ?? Date.now)();
      const game = findGame(await (this.o.list ?? listProcessPaths)(), this.o.rules);
      if (game) {
        this.lastSeen = now;
        if (this.current !== game) {
          this.current = game;
          this.emit('debut', game);
        }
      } else if (this.current && now - this.lastSeen >= (this.o.graceMs ?? 30_000)) {
        const ended = this.current;
        this.current = null;
        this.emit('fin', ended);
      }
    } finally {
      this.scanning = false;
    }
  }
}
