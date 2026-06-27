import { storage } from '@/lib/storage';
import { createId } from '@/lib/format';
import type {
  Attachment,
  EmbeddedChunk,
  Meeting,
  RetrievedChunk,
} from '@/types';

/**
 * Document Retrieval System (RAG, client-side).
 *
 *   Transcript -> Similarity Search -> Relevant Context -> GPT -> Suggestion
 *
 * Responsibilities:
 *  1. Chunk uploaded documents into overlapping passages.
 *  2. Generate embeddings (OpenAI when a local key exists, else a
 *     dependency-free lexical embedding).
 *  3. Persist embeddings locally (localStorage), keyed per meeting.
 *  4. Retrieve the most relevant chunks for a transcript query via cosine
 *     similarity.
 *
 * SECURITY: Embeddings use the OpenAI key stored locally in the browser and
 * are sent only to api.openai.com — never to this app's backend.
 */

/* ---- Tunables ---- */

const CHUNK_SIZE = 800; // characters
const CHUNK_OVERLAP = 150;
const MAX_CHUNKS_PER_MEETING = 200;
const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
const OPENAI_EMBED_DIM = 512;
const LOCAL_EMBED_MODEL = 'local-hash-256';
const LOCAL_EMBED_DIM = 256;
const EMBED_BATCH = 96;

const vectorKey = (meetingId: string): string => `mc.vectors.${meetingId}`;

interface MeetingVectorStore {
  model: string;
  dim: number;
  /** attachmentId -> content hash, to detect when re-embedding is needed. */
  sources: Record<string, string>;
  chunks: EmbeddedChunk[];
}

const emptyStore = (model: string, dim: number): MeetingVectorStore => ({
  model,
  dim,
  sources: {},
  chunks: [],
});

/* ---- Persistence ---- */

function loadStore(meetingId: string): MeetingVectorStore | null {
  try {
    const raw = localStorage.getItem(vectorKey(meetingId));
    return raw ? (JSON.parse(raw) as MeetingVectorStore) : null;
  } catch {
    return null;
  }
}

function saveStore(meetingId: string, store: MeetingVectorStore): void {
  try {
    localStorage.setItem(vectorKey(meetingId), JSON.stringify(store));
  } catch (err) {
    // Embeddings can be large; drop the index rather than break the app.
    console.warn('Failed to persist vector store (quota?). Retrieval disabled.', err);
  }
}

export function clearVectorStore(meetingId: string): void {
  try {
    localStorage.removeItem(vectorKey(meetingId));
  } catch {
    /* ignore */
  }
}

/* ---- 1. Chunking ---- */

export function chunkText(text: string): string[] {
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);

    // Prefer to break on a paragraph or sentence boundary near the limit.
    if (end < clean.length) {
      const window = clean.slice(start, end);
      const para = window.lastIndexOf('\n\n');
      const sentence = Math.max(
        window.lastIndexOf('. '),
        window.lastIndexOf('! '),
        window.lastIndexOf('? '),
      );
      const breakAt = para > CHUNK_SIZE * 0.5 ? para : sentence;
      if (breakAt > CHUNK_SIZE * 0.5) end = start + breakAt + 1;
    }

    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = end - CHUNK_OVERLAP;
    if (start < 0) start = 0;
  }
  return chunks;
}

/* ---- 2. Embeddings ---- */

// Browser-side embeddings call OpenAI's endpoint directly, so only use the key
// when OpenAI is the selected provider. Other providers fall back to the local
// lexical embedding below.
const getApiKey = (): string => {
  const s = storage.getSettings();
  if ((s.aiProvider ?? 'openai') !== 'openai') return '';
  return (s.aiApiKey || s.openaiApiKey || '').trim();
};

/** Stable, dependency-free lexical embedding (hashed bag-of-words). */
function localEmbed(text: string, dim = LOCAL_EMBED_DIM): number[] {
  const vec = new Array<number>(dim).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    // FNV-1a hash for a stable bucket.
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    vec[(h >>> 0) % dim] += 1;
  }
  return normalize(vec);
}

function normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

async function openAiEmbed(texts: string[], key: string): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const batch = texts.slice(i, i + EMBED_BATCH);
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: OPENAI_EMBED_MODEL,
        input: batch,
        dimensions: OPENAI_EMBED_DIM,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embeddings failed (${res.status})`);
    }
    const json = (await res.json()) as { data: { embedding: number[] }[] };
    for (const d of json.data) out.push(d.embedding);
  }
  return out;
}

/** Which embedding model will be used given current key availability. */
function activeModel(): { model: string; dim: number } {
  return getApiKey()
    ? { model: OPENAI_EMBED_MODEL, dim: OPENAI_EMBED_DIM }
    : { model: LOCAL_EMBED_MODEL, dim: LOCAL_EMBED_DIM };
}

/**
 * Embed an array of texts using the active model. Falls back to the local
 * embedding if the OpenAI request fails for any reason.
 */
async function embedTexts(
  texts: string[],
): Promise<{ model: string; dim: number; vectors: number[][] }> {
  if (texts.length === 0) {
    const { model, dim } = activeModel();
    return { model, dim, vectors: [] };
  }
  const key = getApiKey();
  if (key) {
    try {
      const vectors = await openAiEmbed(texts, key);
      return { model: OPENAI_EMBED_MODEL, dim: OPENAI_EMBED_DIM, vectors };
    } catch (err) {
      console.warn('OpenAI embeddings unavailable; using local embeddings.', err);
    }
  }
  return {
    model: LOCAL_EMBED_MODEL,
    dim: LOCAL_EMBED_DIM,
    vectors: texts.map((t) => localEmbed(t)),
  };
}

/* ---- Content hash for idempotent indexing ---- */

function hashText(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36) + ':' + text.length;
}

const indexableAttachments = (meeting: Meeting): Attachment[] =>
  (meeting.attachments ?? []).filter(
    (a) =>
      a.extractedText?.trim() &&
      (a.extractionStatus === 'done' || a.extractionStatus === undefined),
  );

/* ---- 3. Indexing ---- */

export interface IndexResult {
  model: string;
  chunkCount: number;
  documentCount: number;
}

/**
 * Ensure all of a meeting's documents are chunked and embedded. Idempotent:
 * unchanged documents are skipped. Rebuilds when the embedding model changes
 * (e.g. a key was added/removed).
 */
export async function ensureIndexed(meeting: Meeting): Promise<IndexResult> {
  const attachments = indexableAttachments(meeting);
  const { model } = activeModel();

  let store = loadStore(meeting.id);
  // Model switch invalidates existing vectors (different space/dimension).
  if (!store || store.model !== model) {
    const { dim } = activeModel();
    store = emptyStore(model, dim);
  }

  const validIds = new Set(attachments.map((a) => a.id));
  // Drop chunks/sources for attachments that were removed.
  store.chunks = store.chunks.filter((c) => validIds.has(c.attachmentId));
  for (const id of Object.keys(store.sources)) {
    if (!validIds.has(id)) delete store.sources[id];
  }

  let changed = false;
  for (const att of attachments) {
    const text = att.extractedText ?? '';
    const sig = hashText(text);
    if (store.sources[att.id] === sig) continue; // already current

    const pieces = chunkText(text);
    if (pieces.length === 0) {
      store.sources[att.id] = sig;
      continue;
    }
    const { model: usedModel, dim, vectors } = await embedTexts(pieces);

    // If the fallback kicked in mid-way and differs from store model, realign.
    if (usedModel !== store.model) {
      store = emptyStore(usedModel, dim);
    }

    // Remove any prior chunks for this attachment, then add fresh ones.
    store.chunks = store.chunks.filter((c) => c.attachmentId !== att.id);
    pieces.forEach((piece, i) => {
      store!.chunks.push({
        id: createId(),
        attachmentId: att.id,
        attachmentName: att.name,
        index: i,
        text: piece,
        embedding: vectors[i],
      });
    });
    store.sources[att.id] = sig;
    changed = true;
  }

  // Cap total chunks to protect localStorage.
  if (store.chunks.length > MAX_CHUNKS_PER_MEETING) {
    store.chunks = store.chunks.slice(0, MAX_CHUNKS_PER_MEETING);
    changed = true;
  }

  if (changed) saveStore(meeting.id, store);

  return {
    model: store.model,
    chunkCount: store.chunks.length,
    documentCount: attachments.length,
  };
}

/* ---- 4. Similarity search ---- */

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Retrieve the top-K document chunks most similar to the query text.
 * Returns [] when nothing is indexed or the query is empty.
 */
export async function retrieve(
  meetingId: string,
  query: string,
  topK = 4,
  minScore = 0.1,
): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const store = loadStore(meetingId);
  if (!store || store.chunks.length === 0) return [];

  // Embed the query in the SAME space as the stored chunks.
  let queryVec: number[];
  if (store.model === LOCAL_EMBED_MODEL) {
    queryVec = localEmbed(trimmed, store.dim);
  } else {
    const key = getApiKey();
    if (!key) return []; // can't query an OpenAI index without a key
    try {
      [queryVec] = await openAiEmbed([trimmed], key);
    } catch {
      return [];
    }
  }

  return store.chunks
    .map((c) => ({
      source: `${c.attachmentName} #${c.index + 1}`,
      text: c.text,
      score: cosineSimilarity(queryVec, c.embedding),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}
