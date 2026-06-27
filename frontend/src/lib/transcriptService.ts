/**
 * Transcript service.
 *
 * Streams microphone audio to a speech-to-text provider and emits partial
 * (interim) and final transcripts in real time. The default provider is the
 * browser's Web Speech API, which requires no API key. The public surface is
 * provider-agnostic so a cloud provider with speaker diarization can be
 * swapped in later without changing callers.
 */

export type TranscriptStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'reconnecting'
  | 'error';

export interface TranscriptSegment {
  id: string;
  /** Speaker label when the provider supplies one; otherwise the configured default. */
  speaker: string;
  text: string;
  confidence: number;
  timestamp: number;
  isFinal: boolean;
}

export interface TranscriptServiceOptions {
  lang?: string;
  /** Fallback speaker label when the provider has no diarization. */
  speaker?: string;
  onPartial?: (segment: TranscriptSegment) => void;
  onFinal?: (segment: TranscriptSegment) => void;
  onStatus?: (status: TranscriptStatus) => void;
  onError?: (message: string) => void;
}

/* ---- Minimal Web Speech API typings (not in the standard DOM lib) ---- */

interface SpeechAlternative {
  transcript: string;
  confidence: number;
}
interface SpeechResult {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechAlternative;
}
interface SpeechResultList {
  length: number;
  [index: number]: SpeechResult;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: SpeechResultList;
}
interface SpeechRecognitionErrorLike {
  error: string;
}
interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const getRecognitionCtor = (): SpeechRecognitionCtor | null => {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

let segmentCounter = 0;
const nextId = (): string => `seg-${Date.now()}-${segmentCounter++}`;

export class TranscriptService {
  static isSupported(): boolean {
    return getRecognitionCtor() !== null;
  }

  private options: TranscriptServiceOptions;
  private recognition: SpeechRecognitionLike | null = null;
  private status: TranscriptStatus = 'idle';

  /** True while the user wants transcription running (drives auto-reconnect). */
  private active = false;
  private manualStop = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;

  constructor(options: TranscriptServiceOptions = {}) {
    this.options = { lang: 'en-US', speaker: 'Speaker', ...options };
  }

  getStatus(): TranscriptStatus {
    return this.status;
  }

  private setStatus(status: TranscriptStatus) {
    this.status = status;
    this.options.onStatus?.(status);
  }

  private build(text: string, confidence: number, isFinal: boolean): TranscriptSegment {
    return {
      id: nextId(),
      speaker: this.options.speaker ?? 'Speaker',
      text: text.trim(),
      confidence,
      timestamp: Date.now(),
      isFinal,
    };
  }

  private createRecognition(): SpeechRecognitionLike {
    const Ctor = getRecognitionCtor();
    if (!Ctor) throw new Error('Speech recognition is not supported in this browser.');

    const recognition = new Ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = this.options.lang ?? 'en-US';

    recognition.onstart = () => {
      this.reconnectAttempts = 0;
      this.setStatus('listening');
    };

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) {
          const segment = this.build(alt.transcript, alt.confidence ?? 0, true);
          if (segment.text) this.options.onFinal?.(segment);
        } else {
          interim += alt.transcript;
        }
      }
      if (interim.trim()) {
        this.options.onPartial?.(this.build(interim, 0, false));
      }
    };

    recognition.onerror = (event) => {
      // Recoverable: keep the session alive and let onend reconnect.
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      if (event.error === 'network') {
        this.scheduleReconnect();
        return;
      }
      // Fatal: permissions or hardware.
      const message =
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone permission denied for transcription.'
          : event.error === 'audio-capture'
            ? 'No microphone was found.'
            : `Transcription error: ${event.error}`;
      this.options.onError?.(message);
      this.active = false;
      this.setStatus('error');
    };

    // The Web Speech API ends frequently (after pauses). To stream
    // continuously we restart automatically while still active.
    recognition.onend = () => {
      if (this.active && !this.manualStop) {
        this.scheduleReconnect();
      } else {
        this.setStatus('idle');
      }
    };

    return recognition;
  }

  private scheduleReconnect() {
    if (!this.active) return;
    if (this.reconnectTimer) return;
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 1) this.setStatus('reconnecting');
    // Exponential-ish backoff capped at 3s; immediate for the common pause case.
    const delay = Math.min(3000, this.reconnectAttempts === 1 ? 250 : this.reconnectAttempts * 500);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.beginRecognition();
    }, delay);
  }

  private beginRecognition() {
    if (!this.active) return;
    try {
      this.recognition = this.createRecognition();
      this.recognition.start();
    } catch (err) {
      // start() throws if a session is already running; retry shortly.
      if (err instanceof Error && /already started/i.test(err.message)) {
        this.scheduleReconnect();
        return;
      }
      this.options.onError?.(
        err instanceof Error ? err.message : 'Failed to start transcription.',
      );
      this.active = false;
      this.setStatus('error');
    }
  }

  start(): void {
    if (this.active) return;
    if (!TranscriptService.isSupported()) {
      this.options.onError?.('Speech recognition is not supported in this browser.');
      this.setStatus('error');
      return;
    }
    this.active = true;
    this.manualStop = false;
    this.reconnectAttempts = 0;
    this.setStatus('starting');
    this.beginRecognition();
  }

  stop(): void {
    this.manualStop = true;
    this.active = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* ignore */
      }
      this.recognition = null;
    }
    this.setStatus('idle');
  }

  /** Update the fallback speaker label at runtime. */
  setSpeaker(speaker: string): void {
    this.options.speaker = speaker;
  }
}
