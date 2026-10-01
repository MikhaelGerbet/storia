// Le « format d'histoire » : le brouillon écrit par l'IA, puis la scène que le lecteur joue.
// L'IA choisit les mots et les bruitages dans une liste fermée ; le code applique les règles de mise en son.

export const AGE_BANDS = ['3-5', '6-8', '9-12', 'ados', 'adultes'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];

export interface AgeProfile {
  label: string;
  minSegments: number;
  maxSegments: number;
  maxWords: number;
  tone: string;
  /** Débuts de mots à éviter pour cet âge (garde-fou simple, avant une vraie modération). */
  avoid: string[];
  imageStyle: string;
}

export const AGE_PROFILES: Record<AgeBand, AgeProfile> = {
  '3-5': {
    label: 'tout-petits (3-5 ans)',
    minSegments: 4,
    maxSegments: 6,
    maxWords: 10,
    tone: 'Très doux et rassurant. Phrases très courtes, mots simples du quotidien. Aucun danger, aucune peur : seulement une jolie surprise.',
    avoid: ['mort', 'mourir', 'meurt', 'tuer', 'tué', 'sang', 'monstre', 'fantôme', 'squelette', 'peur', 'terrifi', 'effray', 'horrible', 'hurl', 'crier', 'noy', 'sabre', 'épée', 'canon', 'pistolet', 'arme'],
    imageStyle: "soft children's picture book illustration for toddlers, rounded shapes, gentle warm colors, very cute and cozy",
  },
  '6-8': {
    label: 'enfants (6-8 ans)',
    minSegments: 5,
    maxSegments: 7,
    maxWords: 14,
    tone: 'Mystérieux mais jamais effrayant. Phrases courtes et rythmées, vocabulaire simple avec un ou deux mots un peu magiques. Tout reste rassurant.',
    avoid: ['mourir', 'meurt', 'tuer', 'tué', 'sang', 'cadavre', 'squelette', 'terrifi', 'horreur', 'horrible', 'hurl', 'noy'],
    imageStyle: "children's storybook illustration, soft painterly gouache, gentle and cozy",
  },
  '9-12': {
    label: 'grands enfants (9-12 ans)',
    minSegments: 5,
    maxSegments: 8,
    maxWords: 18,
    tone: "Aventure et un peu de suspense, vocabulaire riche mais clair. Pas de violence ni d'horreur.",
    avoid: ['sang', 'cadavre', 'tuer', 'massacr', 'tortur', 'horreur'],
    imageStyle: 'detailed storybook illustration, painterly, adventurous mood',
  },
  ados: {
    label: 'adolescents',
    minSegments: 5,
    maxSegments: 8,
    maxWords: 22,
    tone: 'Atmosphère et suspense assumés, style vivant et moderne. Pas de violence explicite.',
    avoid: ['tortur', 'massacr', 'gore'],
    imageStyle: 'cinematic painterly illustration, atmospheric lighting',
  },
  adultes: {
    label: 'adultes',
    minSegments: 5,
    maxSegments: 8,
    maxWords: 26,
    tone: 'Style littéraire et évocateur, atmosphère riche, une pointe de mélancolie. Pas de contenu explicite.',
    avoid: [],
    imageStyle: 'cinematic painterly illustration, moody atmosphere, fine detail',
  },
};

/** Les bruitages que le lecteur sait jouer pour ce décor. */
export const EFFECTS = ['aucun', 'goutte', 'vague', 'grincement', 'revelation', 'lanterne', 'cloche'] as const;
export type Effect = (typeof EFFECTS)[number];
type SoundEffect = Exclude<Effect, 'aucun'>;

export interface DraftSegment {
  texte: string;
  effet: Effect;
}

export interface Draft {
  titre: string;
  accroche: string;
  segments: DraftSegment[];
  decor_en: string;
}

export interface PlayerCue {
  at: number | 'intro' | 'outro';
  when?: 'start' | 'end';
  delay: number;
  run: string;
}

export interface PlayerScene {
  title: string;
  audience: string;
  intro: number;
  segments: { text: string; pause: number }[];
  cues: PlayerCue[];
}

/** Schéma JSON imposé à la réponse du modèle (sortie structurée d'Ollama). */
export function draftSchema(profile: AgeProfile): object {
  return {
    type: 'object',
    properties: {
      titre: { type: 'string' },
      accroche: { type: 'string' },
      segments: {
        type: 'array',
        minItems: profile.minSegments,
        maxItems: profile.maxSegments,
        items: {
          type: 'object',
          properties: {
            texte: { type: 'string' },
            effet: { type: 'string', enum: [...EFFECTS] },
          },
          required: ['texte', 'effet'],
        },
      },
      decor_en: { type: 'string' },
    },
    required: ['titre', 'accroche', 'segments', 'decor_en'],
  };
}

const isEffect = (value: unknown): value is Effect => typeof value === 'string' && (EFFECTS as readonly string[]).includes(value);
const clean = (value: unknown): string => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');

/** Vérifie et nettoie la réponse du modèle. */
export function parseDraft(raw: unknown, profile: AgeProfile): Draft {
  if (!raw || typeof raw !== 'object') throw new Error("La réponse du modèle n'est pas un objet JSON.");
  const r = raw as Record<string, unknown>;
  const segments = (Array.isArray(r.segments) ? r.segments : [])
    .map((s): DraftSegment => {
      const seg = (s ?? {}) as Record<string, unknown>;
      return { texte: clean(seg.texte), effet: isEffect(seg.effet) ? seg.effet : 'aucun' };
    })
    .filter((s) => s.texte.length > 0)
    .slice(0, profile.maxSegments);
  if (segments.length < 3) throw new Error(`Le modèle n'a écrit que ${segments.length} segment(s) : relance la génération.`);
  const titre = clean(r.titre) || "L'histoire sans titre";
  return { titre, accroche: clean(r.accroche), segments, decor_en: clean(r.decor_en) };
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Renvoie les débuts de mots à éviter présents dans les textes. */
export function findAvoided(texts: string[], profile: AgeProfile): string[] {
  return profile.avoid.filter((stem) => {
    const re = new RegExp(`(?<!\\p{L})${escapeRegExp(stem)}`, 'iu');
    return texts.some((t) => re.test(t));
  });
}

const MAX_USES: Record<SoundEffect, number> = { goutte: 2, vague: 2, grincement: 2, revelation: 1, lanterne: 1, cloche: 1 };

/**
 * Règles de mise en son : une seule révélation du bateau (au segment où il apparaît),
 * la lanterne après la révélation, la cloche à la fin, et pas plus d'un bruitage tous les deux segments.
 */
export function arrangeEffects(input: DraftSegment[]): { segments: DraftSegment[]; notes: string[] } {
  const segs = input.map((s) => ({ ...s }));
  const notes: string[] = [];
  const n = segs.length;
  const last = n - 1;

  segs.forEach((s, i) => {
    if (s.effet !== 'cloche' || i === last) return;
    s.effet = 'aucun';
    if (segs[last].effet === 'aucun') {
      segs[last].effet = 'cloche';
      notes.push('cloche déplacée au dernier segment');
    } else {
      notes.push('cloche retirée (elle ne sonne qu’à la fin)');
    }
  });

  let reveal = segs.findIndex((s) => s.effet === 'revelation');
  segs.forEach((s, i) => {
    if (s.effet === 'revelation' && i !== reveal) {
      s.effet = 'aucun';
      notes.push('révélation en trop retirée');
    }
  });
  if (reveal === -1) {
    const mention = segs.findIndex((s) => /(?<!\p{L})(bateau|navire|galion|vaisseau|trois-mâts)/iu.test(s.texte));
    reveal = mention !== -1 ? mention : Math.floor(n / 2);
    if (segs[reveal].effet !== 'aucun') notes.push(`${segs[reveal].effet} remplacé(e) par la révélation du bateau`);
    segs[reveal].effet = 'revelation';
    notes.push(`révélation du bateau placée au segment ${reveal + 1}`);
  }

  segs.forEach((s, i) => {
    if (s.effet === 'lanterne' && i <= reveal) {
      s.effet = 'aucun';
      notes.push('lanterne retirée (elle doit s’allumer après la révélation)');
    }
  });

  const used: Partial<Record<SoundEffect, number>> = {};
  for (const s of segs) {
    if (s.effet === 'aucun') continue;
    used[s.effet] = (used[s.effet] ?? 0) + 1;
    if ((used[s.effet] ?? 0) > MAX_USES[s.effet]) {
      notes.push(`${s.effet} en trop retiré(e)`);
      s.effet = 'aucun';
    }
  }

  const limit = Math.ceil(n / 2);
  let count = 0;
  for (const s of segs) {
    if (s.effet === 'aucun' || s.effet === 'revelation') continue;
    count++;
    if (count > limit) {
      notes.push(`${s.effet} retiré(e) : trop de bruitages`);
      s.effet = 'aucun';
    }
  }
  return { segments: segs, notes };
}

/** Pause après un segment, d'après sa ponctuation et son bruitage. */
export function pauseFor(text: string, effet: Effect, isLast: boolean): number {
  if (isLast) return 0.3;
  const t = text.trim();
  let pause = /(…|\.\.\.)$/.test(t) ? 0.8 : /[.!?]$/.test(t) ? 0.7 : /[,;:]$/.test(t) ? 0.35 : 0.3;
  if (effet === 'goutte') pause = Math.max(pause, 1.0); // la goutte tombe pendant la pause
  return pause;
}

const PLACEMENT: Record<SoundEffect, { when: 'start' | 'end'; delay: number; run: string }[]> = {
  goutte: [{ when: 'end', delay: 0, run: 'drip' }],
  vague: [{ when: 'start', delay: 0.45, run: 'swell' }],
  grincement: [{ when: 'start', delay: 0.4, run: 'creak' }],
  revelation: [{ when: 'start', delay: 0, run: 'revealShip' }, { when: 'start', delay: 0.6, run: 'creak' }],
  lanterne: [{ when: 'start', delay: 0.15, run: 'lantern' }],
  cloche: [{ when: 'end', delay: 0.3, run: 'bell' }],
};

/** Transforme le brouillon (après les règles) en scène jouable par le lecteur. */
export function toPlayerScene(draft: Draft, age: AgeBand): PlayerScene {
  const last = draft.segments.length - 1;
  const cues: PlayerCue[] = [
    { at: 'intro', delay: 0, run: 'ambience' },
    { at: 'intro', delay: 0, run: 'dawn' },
    { at: 'intro', delay: 0.2, run: 'drip' },
  ];
  draft.segments.forEach((s, i) => {
    if (s.effet === 'aucun') return;
    for (const rule of PLACEMENT[s.effet]) cues.push({ at: i, when: rule.when, delay: rule.delay, run: rule.run });
  });
  cues.push({ at: 'outro', delay: 2.8, run: 'endCard' });
  return {
    title: draft.titre,
    audience: AGE_PROFILES[age].label,
    intro: 1.8,
    segments: draft.segments.map((s, i) => ({ text: s.texte, pause: pauseFor(s.texte, s.effet, i === last) })),
    cues,
  };
}

/**
 * Prompt d'image. La composition est imposée pour que les effets du lecteur tombent juste
 * (l'eau dans le tiers bas, le bateau au centre) ; le modèle de texte n'ajoute que des détails.
 */
export function imagePrompt(draft: Draft, age: AgeBand): string {
  const gentle = age === '3-5' || age === '6-8' ? ' Gentle, cozy and not scary.' : '';
  const details = draft.decor_en ? ` ${draft.decor_en.replace(/\s*$/, '')}` : '';
  return (
    `${AGE_PROFILES[age].imageStyle}. Inside a vast sea cave at night, seen from water level: a small old pirate ship floats in the middle of the cave; ` +
    'behind it, a large opening in the cave wall looks out onto the open sea, with a full moon and a silver path of moonlight on the calm water; ' +
    `a thin waterfall pours down the left cave wall. The calm water surface fills the lower third of the image.${details}${gentle} ` +
    'Wide landscape composition, no text, no letters, no people.'
  );
}

/** Consigne de mouvement pour Wan 2.2 : de petits mouvements continus et une caméra fixe, pour une boucle sans à-coup. */
export function loopPrompt(age: AgeBand): string {
  return (
    `${AGE_PROFILES[age].imageStyle}. A small old pirate ship floats in a vast sea cave at night. ` +
    'Gentle, continuous ambient motion: the water ripples and sways softly, moonlight reflections shimmer on the surface, ' +
    'the ship rocks very slightly, its sails barely flutter, the thin waterfall pours steadily, light mist drifts slowly. ' +
    'The camera is perfectly still: no zoom, no pan, no cut. Calm and dreamy.'
  );
}
