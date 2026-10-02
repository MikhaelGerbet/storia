// La bibliothèque : les histoires générées, leurs mots-clés, leurs lectures, et la recherche plein texte.
// SQLite intégré à Node (node:sqlite) : rien à installer. La recherche ignore les accents (« ile » trouve « île »).
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export interface StoryRecord {
  id: string;
  titre: string;
  accroche: string;
  theme: string | null;
  age: string;
  dureeSecondes: number;
  motsCles: string[];
  texte: string;
  composition: Record<string, unknown> | null;
  /** Dossier de l'histoire, dans le dossier de la bibliothèque. */
  dossier: string;
  image: string | null;
  animation: string | null;
  page: string;
  lectures: number;
  favori: boolean;
  creeLe: string;
  derniereLecture: string | null;
}

export type NewStory = Omit<StoryRecord, 'id' | 'lectures' | 'favori' | 'creeLe' | 'derniereLecture'> & { id?: string; creeLe?: string };

export interface SearchOptions {
  q?: string;
  theme?: string;
  age?: string;
  favoris?: boolean;
  /** recentes (par défaut), populaires, ecoutees, courtes, pertinence (par défaut avec une recherche) */
  tri?: string;
  limite?: number;
  decalage?: number;
}

/** Identifiant court et lisible : h-<date>-<hasard>. */
export function newStoryId(date = new Date()): string {
  const d = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `h-${d}-${randomBytes(3).toString('hex')}`;
}

/** Transforme la saisie en requête FTS5 : chaque mot est un préfixe (« pira » trouve « pirates »). */
export function ftsQuery(text: string): string | null {
  const all = text
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
  // « l'île » : le « l » isolé ne trouverait que du bruit.
  const words = (all.some((w) => w.length > 1) ? all.filter((w) => w.length > 1) : all).slice(0, 8);
  return words.length ? words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' ') : null;
}

interface Row {
  id: string;
  titre: string;
  accroche: string;
  theme: string | null;
  age: string;
  duree_secondes: number;
  mots_cles: string;
  texte: string;
  composition: string | null;
  dossier: string;
  image: string | null;
  animation: string | null;
  page: string;
  lectures: number;
  favori: number;
  cree_le: string;
  derniere_lecture: string | null;
}

function toRecord(row: Row): StoryRecord {
  return {
    id: row.id,
    titre: row.titre,
    accroche: row.accroche,
    theme: row.theme,
    age: row.age,
    dureeSecondes: row.duree_secondes,
    motsCles: JSON.parse(row.mots_cles) as string[],
    texte: row.texte,
    composition: row.composition ? (JSON.parse(row.composition) as Record<string, unknown>) : null,
    dossier: row.dossier,
    image: row.image,
    animation: row.animation,
    page: row.page,
    lectures: row.lectures,
    favori: row.favori === 1,
    creeLe: row.cree_le,
    derniereLecture: row.derniere_lecture,
  };
}

export class Library {
  readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS histoires (
        id TEXT PRIMARY KEY,
        titre TEXT NOT NULL,
        accroche TEXT NOT NULL DEFAULT '',
        theme TEXT,
        age TEXT NOT NULL,
        duree_secondes INTEGER NOT NULL DEFAULT 0,
        mots_cles TEXT NOT NULL DEFAULT '[]',
        texte TEXT NOT NULL DEFAULT '',
        composition TEXT,
        dossier TEXT NOT NULL,
        image TEXT,
        animation TEXT,
        page TEXT NOT NULL DEFAULT 'index.html',
        lectures INTEGER NOT NULL DEFAULT 0,
        favori INTEGER NOT NULL DEFAULT 0,
        cree_le TEXT NOT NULL,
        derniere_lecture TEXT
      );
      CREATE INDEX IF NOT EXISTS histoires_cree_le ON histoires (cree_le);
      CREATE VIRTUAL TABLE IF NOT EXISTS histoires_fts USING fts5(
        id UNINDEXED, titre, accroche, mots_cles, texte,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
  }

  add(story: NewStory): StoryRecord {
    const id = story.id ?? newStoryId();
    const creeLe = story.creeLe ?? new Date().toISOString();
    const keywords = JSON.stringify(story.motsCles);
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare(
          `INSERT INTO histoires (id, titre, accroche, theme, age, duree_secondes, mots_cles, texte, composition, dossier, image, animation, page, cree_le)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(id, story.titre, story.accroche, story.theme, story.age, Math.round(story.dureeSecondes), keywords, story.texte,
          story.composition ? JSON.stringify(story.composition) : null, story.dossier, story.image, story.animation, story.page, creeLe);
      this.db.prepare('INSERT INTO histoires_fts (id, titre, accroche, mots_cles, texte) VALUES (?, ?, ?, ?, ?)')
        .run(id, story.titre, story.accroche, story.motsCles.join(' '), story.texte);
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return this.get(id) as StoryRecord;
  }

  get(id: string): StoryRecord | undefined {
    const row = this.db.prepare('SELECT * FROM histoires WHERE id = ?').get(id) as Row | undefined;
    return row ? toRecord(row) : undefined;
  }

  search(o: SearchOptions = {}): { histoires: StoryRecord[]; total: number } {
    const where: string[] = [];
    const params: (string | number)[] = [];
    const query = o.q ? ftsQuery(o.q) : null;
    let from = 'histoires h';
    if (query) {
      from = 'histoires_fts f JOIN histoires h ON h.id = f.id';
      where.push('histoires_fts MATCH ?');
      params.push(query);
    }
    if (o.theme) {
      where.push('h.theme = ?');
      params.push(o.theme);
    }
    if (o.age) {
      where.push('h.age = ?');
      params.push(o.age);
    }
    if (o.favoris) where.push('h.favori = 1');
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order =
      o.tri === 'populaires'
        ? 'h.lectures DESC, h.cree_le DESC'
        : o.tri === 'courtes'
          ? 'h.duree_secondes ASC, h.cree_le DESC'
          : o.tri === 'ecoutees'
            ? 'h.derniere_lecture IS NULL, h.derniere_lecture DESC, h.cree_le DESC' // les dernières écoutées d'abord
            : query && (o.tri === 'pertinence' || !o.tri)
              ? 'bm25(histoires_fts, 0, 10, 4, 6, 1), h.cree_le DESC' // le titre pèse le plus, puis les mots-clés
              : 'h.cree_le DESC';
    const limit = Math.min(Math.max(o.limite ?? 60, 1), 200);
    const offset = Math.max(o.decalage ?? 0, 0);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM ${from} ${clause}`).get(...params) as { n: number }).n;
    const rows = this.db.prepare(`SELECT h.* FROM ${from} ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, limit, offset) as unknown as Row[];
    return { histoires: rows.map(toRecord), total };
  }

  /** Une lecture de plus, au moment où l'histoire commence. */
  countRead(id: string): StoryRecord | undefined {
    this.db.prepare('UPDATE histoires SET lectures = lectures + 1, derniere_lecture = ? WHERE id = ?').run(new Date().toISOString(), id);
    return this.get(id);
  }

  setFavorite(id: string, favori: boolean): StoryRecord | undefined {
    this.db.prepare('UPDATE histoires SET favori = ? WHERE id = ?').run(favori ? 1 : 0, id);
    return this.get(id);
  }

  remove(id: string): boolean {
    this.db.exec('BEGIN');
    try {
      const changes = Number(this.db.prepare('DELETE FROM histoires WHERE id = ?').run(id).changes);
      this.db.prepare('DELETE FROM histoires_fts WHERE id = ?').run(id);
      this.db.exec('COMMIT');
      return changes > 0;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Les mots-clés les plus fréquents, pour suggérer des recherches. */
  topKeywords(limit = 12): { motCle: string; histoires: number }[] {
    const counts = new Map<string, number>();
    for (const row of this.db.prepare('SELECT mots_cles FROM histoires').all() as { mots_cles: string }[]) {
      for (const k of JSON.parse(row.mots_cles) as string[]) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
      .slice(0, limit)
      .map(([motCle, histoires]) => ({ motCle, histoires }));
  }

  stats(): { histoires: number; lectures: number; minutes: number } {
    const row = this.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(lectures), 0) AS l, COALESCE(SUM(duree_secondes), 0) AS d FROM histoires').get() as { n: number; l: number; d: number };
    return { histoires: row.n, lectures: row.l, minutes: Math.round(row.d / 60) };
  }

  close(): void {
    this.db.close();
  }
}
