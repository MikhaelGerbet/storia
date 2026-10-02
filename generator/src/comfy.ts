// Image : ComfyUI. On réutilise un workflow exporté au format API, dans lequel le prompt positif vaut {{PROMPT}}.

export const PROMPT_TOKEN = '{{PROMPT}}';

type WorkflowNode = { class_type?: string; inputs?: Record<string, unknown> };
export type Workflow = Record<string, WorkflowNode>;

interface HistoryImage {
  filename: string;
  subfolder?: string;
  type?: string;
}
interface HistoryEntry {
  outputs?: Record<string, { images?: HistoryImage[] }>;
  status?: { status_str?: string; completed?: boolean; messages?: unknown };
}

/** Copie le workflow, y place le prompt et la graine. */
export function prepareWorkflow(raw: unknown, prompt: string, seed: number): Workflow {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Workflow ComfyUI illisible.');
  if ('nodes' in raw && 'links' in raw) {
    throw new Error('Ce workflow est au format « interface ». Dans ComfyUI, exporte-le au format API (menu Workflow, « Export (API) »).');
  }
  const workflow = structuredClone(raw) as Workflow;
  let replaced = 0;
  for (const node of Object.values(workflow)) {
    const inputs = node?.inputs;
    if (!inputs || typeof inputs !== 'object') continue;
    for (const [key, value] of Object.entries(inputs)) {
      if (typeof value === 'string' && value.includes(PROMPT_TOKEN)) {
        inputs[key] = value.split(PROMPT_TOKEN).join(prompt);
        replaced++;
      } else if ((key === 'seed' || key === 'noise_seed') && typeof value === 'number') {
        inputs[key] = seed;
      }
    }
  }
  if (!replaced) {
    throw new Error(`Aucun champ du workflow ne contient ${PROMPT_TOKEN}. Écris ${PROMPT_TOKEN} dans la zone du prompt positif, puis réexporte au format API.`);
  }
  return workflow;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function generateImage(o: {
  url: string;
  workflow: Workflow;
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
}): Promise<{ bytes: Uint8Array; mime: string }> {
  let res: Response;
  try {
    res = await fetch(`${o.url}/prompt`, {
      signal: o.signal,
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: o.workflow, client_id: crypto.randomUUID() }),
    });
  } catch {
    o.signal?.throwIfAborted();
    throw new Error(`ComfyUI ne répond pas sur ${o.url}. Lance ComfyUI, ou indique son adresse avec --comfy.`);
  }
  const queued = (await res.json().catch(() => ({}))) as { prompt_id?: string; error?: unknown; node_errors?: unknown };
  if (!res.ok || !queued.prompt_id) {
    throw new Error(`ComfyUI a refusé le workflow : ${JSON.stringify(queued.error ?? queued.node_errors ?? queued).slice(0, 400)}`);
  }
  const id = queued.prompt_id;
  const deadline = Date.now() + (o.timeoutMs ?? 300_000);
  while (Date.now() < deadline) {
    await sleep(o.pollMs ?? 1000);
    o.signal?.throwIfAborted();
    const history = (await (await fetch(`${o.url}/history/${id}`, { signal: o.signal })).json()) as Record<string, HistoryEntry>;
    const entry = history[id];
    if (!entry) continue; // encore en file d'attente ou en cours
    if (entry.status?.status_str === 'error') {
      throw new Error(`ComfyUI a échoué : ${JSON.stringify(entry.status.messages ?? '').slice(0, 400)}`);
    }
    const images = Object.values(entry.outputs ?? {}).flatMap((out) => out.images ?? []);
    const image = images.find((im) => im.type === 'output') ?? images[0];
    if (!image) {
      if (entry.status?.completed) throw new Error("ComfyUI n'a produit aucune image : le workflow doit se terminer par un nœud « Save Image ».");
      continue;
    }
    const query = new URLSearchParams({ filename: image.filename, subfolder: image.subfolder ?? '', type: image.type ?? 'output' });
    const file = await fetch(`${o.url}/view?${query}`);
    if (!file.ok) throw new Error(`Impossible de récupérer l'image générée (erreur ${file.status}).`);
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.headers.get('content-type') ?? 'image/png' };
  }
  throw new Error("ComfyUI n'a pas terminé l'image à temps (5 minutes).");
}
