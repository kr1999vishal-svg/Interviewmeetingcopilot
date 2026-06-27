import { toFile } from 'openai';
import { resolveAi, type AiCredentials } from '../ai/provider.js';
import { HttpError } from '../middleware/errorHandler.js';

export interface TranscribeResult {
  text: string;
  model: string;
}

/** Default speech-to-text model (OpenAI-compatible audio transcription). */
const DEFAULT_STT_MODEL = 'whisper-1';

function extFor(mimeType: string): string {
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'mp4';
  if (mimeType.includes('wav')) return 'wav';
  return 'webm';
}

/**
 * Transcribe a single audio segment using an OpenAI-compatible transcription
 * endpoint (Whisper). The audio is the meeting tab's output captured locally by
 * the extension — i.e. the remote participants' voices — so transcription stays
 * private to the user (no in-meeting captions are enabled).
 *
 * @throws HttpError(400) for empty audio, (503) when no API key is configured.
 */
export async function transcribeAudio(
  audio: Buffer,
  mimeType: string,
  creds: AiCredentials,
  sttModel?: string,
): Promise<TranscribeResult> {
  if (!audio || audio.length === 0) {
    throw new HttpError(400, 'No audio data received.');
  }

  const { client } = resolveAi(creds);
  const model = sttModel?.trim() || DEFAULT_STT_MODEL;
  const type = mimeType || 'audio/webm';

  const file = await toFile(audio, `segment.${extFor(type)}`, { type });

  try {
    const resp = await client.audio.transcriptions.create({ file, model });
    return { text: (resp.text || '').trim(), model };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    const detail = (err as { message?: string })?.message ?? 'Transcription failed.';
    if (status === 404) {
      throw new HttpError(
        502,
        `Transcription model "${model}" is unavailable for this provider. Speech-to-text requires an OpenAI (or OpenAI-compatible) key.`,
      );
    }
    throw new HttpError(status && status >= 400 && status < 600 ? status : 502, detail);
  }
}
