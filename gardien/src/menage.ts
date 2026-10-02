// Le ménage de la carte graphique : décharger les modèles d'Ollama, demander aux serveurs (la voix de Storia…)
// de rendre leur mémoire. Wan2GP, lui, est lancé pour chaque tâche et s'arrête après : il ne reste jamais.

export interface CleanupTargets {
  /** Ollama, dont on décharge tous les modèles chargés ; null : pas d'Ollama. */
  ollama: string | null;
  /** Adresses à appeler en POST pour qu'un serveur rende la mémoire de la carte (ex. http://localhost:8001/liberer). */
  liberer: string[];
}

async function post(url: string, body: unknown, timeoutMs: number): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

/** Vide la carte de ce que les autres y ont laissé ; renvoie ce qui a été libéré. Ne lève jamais d'erreur. */
export async function freeGpu(t: CleanupTargets): Promise<string[]> {
  const freed: string[] = [];
  if (t.ollama) {
    let models: { name?: string; model?: string }[] = [];
    try {
      const res = await fetch(`${t.ollama}/api/ps`, { signal: AbortSignal.timeout(3000) });
      models = ((await res.json()) as { models?: typeof models }).models ?? [];
    } catch {
      // Ollama arrêté : il n'occupe rien.
    }
    for (const m of models) {
      const name = m.model ?? m.name;
      if (!name) continue;
      try {
        // keep_alive à 0 : Ollama décharge le modèle tout de suite.
        if ((await post(`${t.ollama}/api/generate`, { model: name, keep_alive: 0 }, 30_000)).ok) freed.push(`Ollama (${name})`);
      } catch {
        // Un modèle qui ne génère pas de texte (embeddings) se décharge seul après quelques minutes.
      }
    }
  }
  for (const url of t.liberer) {
    try {
      if ((await post(url, {}, 60_000)).ok) freed.push(new URL(url).host);
    } catch {
      // Serveur arrêté : il n'occupe pas la carte.
    }
  }
  return freed;
}
