// La file de la carte graphique : un seul programme à la fois, dans l'ordre des priorités, puis d'arrivée.
// Un programme qui ne donne plus signe de vie perd sa place (il a planté) : la carte ne reste jamais bloquée.
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export const PRIORITIES = ['haute', 'normale', 'basse'] as const;
export type Priority = (typeof PRIORITIES)[number];
const RANK: Record<Priority, number> = { haute: 0, normale: 1, basse: 2 };

/** attente → accordee → terminee ; accordee → revoquee quand un jeu réclame la carte. */
export type ReservationState = 'attente' | 'accordee' | 'revoquee' | 'terminee';

export interface Reservation {
  id: string;
  /** Le programme : storia, oula… */
  client: string;
  /** Ce qu'il en fait, pour l'affichage : « La Boussole qui chantait ». */
  motif: string;
  priorite: Priority;
  etat: ReservationState;
  /** Interrompue par un jeu : elle repasse devant celles de sa priorité. */
  reprise: boolean;
  /** Tenue par le gardien lui-même (une tâche Wan) : pas besoin de signe de vie. */
  interne: boolean;
  demandeeLe: number;
  accordeeLe: number | null;
  vuLe: number;
  seq: number;
}

export interface Pause {
  raison: 'jeu' | 'manuel';
  /** Le jeu détecté, par exemple « eldenring.exe ». */
  detail?: string;
  depuis: number;
}

export interface SchedulerOptions {
  /** Sans signe de vie pendant ce temps, une réservation est abandonnée (90 s). */
  leaseMs?: number;
  now?: () => number;
  /**
   * Appelé avant de passer la carte d'un programme à un autre : on vide d'abord ce que le précédent
   * y a laissé (modèles d'Ollama, voix…). Le suivant n'obtient la carte qu'une fois le ménage fait.
   */
  beforeSwitch?: (previous: string, next: Reservation) => Promise<unknown>;
}

export class Scheduler extends EventEmitter {
  private readonly reservations = new Map<string, Reservation>();
  private seq = 0;
  private readonly leaseMs: number;
  private readonly now: () => number;
  private readonly beforeSwitch: SchedulerOptions['beforeSwitch'];
  private preparing = false;
  pause: Pause | null = null;
  /** Le programme dont les modèles occupent peut-être encore la carte ; null une fois le ménage fait. */
  lastClient: string | null = null;

  constructor(o: SchedulerOptions = {}) {
    super();
    this.leaseMs = o.leaseMs ?? 90_000;
    this.now = o.now ?? Date.now;
    this.beforeSwitch = o.beforeSwitch;
  }

  /** La carte vient d'être vidée (ménage fait par le gardien). */
  cleaned(): void {
    if (!this.holder()) this.lastClient = null;
  }

  request(o: { client: string; motif?: string; priorite?: Priority; reprise?: boolean; interne?: boolean }): Reservation {
    const now = this.now();
    const r: Reservation = {
      id: randomUUID(),
      client: o.client,
      motif: o.motif ?? '',
      priorite: o.priorite ?? 'normale',
      etat: 'attente',
      reprise: o.reprise ?? false,
      interne: o.interne ?? false,
      demandeeLe: now,
      accordeeLe: null,
      vuLe: now,
      seq: ++this.seq,
    };
    this.reservations.set(r.id, r);
    this.changed();
    return r;
  }

  get(id: string): Reservation | undefined {
    return this.reservations.get(id);
  }

  /** Un signe de vie : la réservation est gardée. */
  touch(id: string): Reservation | undefined {
    const r = this.reservations.get(id);
    if (r) r.vuLe = this.now();
    return r;
  }

  release(id: string): boolean {
    const r = this.reservations.get(id);
    if (!r) return false;
    this.reservations.delete(id);
    if (r.etat === 'accordee') this.lastClient = r.client;
    r.etat = 'terminee';
    this.changed();
    return true;
  }

  holder(): Reservation | null {
    for (const r of this.reservations.values()) if (r.etat === 'accordee') return r;
    return null;
  }

  /** Les réservations en attente, la prochaine d'abord. */
  waiting(): Reservation[] {
    return [...this.reservations.values()]
      .filter((r) => r.etat === 'attente')
      .sort((a, b) => RANK[a.priorite] - RANK[b.priorite] || Number(b.reprise) - Number(a.reprise) || a.seq - b.seq);
  }

  /** Rang dans la file : 1 pour la prochaine. */
  position(id: string): number | null {
    const index = this.waiting().findIndex((r) => r.id === id);
    return index < 0 ? null : index + 1;
  }

  /** Pourquoi cette réservation attend encore, en clair. */
  reason(id: string): string | null {
    const r = this.reservations.get(id);
    if (!r || r.etat !== 'attente') return null;
    if (this.pause) return this.pause.raison === 'jeu' ? `est réservée au jeu${this.pause.detail ? ` (${this.pause.detail})` : ''}` : 'est en pause';
    const holder = this.holder();
    const ahead = (this.position(id) ?? 1) - 1;
    const parts = [holder ? `est utilisée par ${holder.client}` : 'se libère'];
    if (ahead > 0) parts.push(`${ahead} demande${ahead > 1 ? 's' : ''} avant toi`);
    return parts.join(', ');
  }

  /** Mode jeu : plus personne n'obtient la carte ; le programme qui la tient doit la rendre si on interrompt. */
  setPause(pause: Pause | null, interrupt = true): Reservation | null {
    this.pause = pause;
    let revoked: Reservation | null = null;
    if (pause && interrupt) {
      const holder = this.holder();
      if (holder) {
        holder.etat = 'revoquee';
        this.lastClient = holder.client;
        revoked = holder;
        this.emit('revoke', holder);
      }
    }
    this.changed();
    return revoked;
  }

  /** Retire les réservations abandonnées et donne la carte à la suivante. À appeler régulièrement. */
  tick(): void {
    const now = this.now();
    let removed = false;
    for (const r of [...this.reservations.values()]) {
      const stale = !r.interne && now - r.vuLe > this.leaseMs;
      // Une réservation révoquée a été prévenue : elle disparaît dès qu'elle l'a vu, ou au bout du délai.
      if (stale || (r.etat === 'revoquee' && now - r.vuLe > this.leaseMs)) {
        this.reservations.delete(r.id);
        if (r.etat === 'accordee') {
          this.lastClient = r.client;
          this.emit('abandon', r);
        }
        removed = true;
      }
    }
    if (removed) this.changed();
    else this.grantNext();
  }

  /** Plus rien en cours ni en attente. */
  isIdle(): boolean {
    return [...this.reservations.values()].every((r) => r.etat === 'revoquee' || r.etat === 'terminee');
  }

  private changed(): void {
    this.grantNext();
    this.emit('change');
  }

  private grantNext(): void {
    if (this.pause || this.holder() || this.preparing) return;
    const next = this.waiting()[0];
    if (!next) {
      if (this.isIdle()) this.emit('idle');
      return;
    }
    if (this.beforeSwitch && this.lastClient !== null && this.lastClient !== next.client) {
      // Ménage d'abord, puis on regarde à nouveau qui passe (une demande prioritaire a pu arriver entre-temps).
      this.preparing = true;
      const previous = this.lastClient;
      this.beforeSwitch(previous, next)
        .catch(() => {})
        .finally(() => {
          this.preparing = false;
          if (!this.holder()) this.lastClient = null;
          this.changed();
        });
      return;
    }
    next.etat = 'accordee';
    next.accordeeLe = this.now();
    next.vuLe = this.now();
    this.emit('grant', next, this.lastClient);
    this.emit('change');
  }
}
