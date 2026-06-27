/**
 * AudioCapture service.
 *
 * Captures audio from the microphone and/or a selected browser tab using the
 * browser media APIs (getUserMedia / getDisplayMedia), exposes a real-time
 * level meter via the Web Audio API, and emits encoded audio chunks (from
 * MediaRecorder) that callers can stream over a WebSocket.
 */

export type AudioSource = 'microphone' | 'tab' | 'both';

export type CaptureStatus = 'idle' | 'requesting' | 'listening' | 'error';

export interface AudioCaptureOptions {
  source?: AudioSource;
  /** How often MediaRecorder emits a chunk, in ms. */
  timeSliceMs?: number;
  onChunk?: (chunk: Blob) => void;
  /** Normalized 0..1 input level for a VU meter. */
  onLevel?: (level: number) => void;
  onStatus?: (status: CaptureStatus) => void;
  onError?: (message: string) => void;
}

const pickMimeType = (): string => {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
};

export class AudioCapture {
  private options: Required<Pick<AudioCaptureOptions, 'source' | 'timeSliceMs'>> &
    AudioCaptureOptions;

  private status: CaptureStatus = 'idle';
  private rawStreams: MediaStream[] = [];
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private destination: MediaStreamAudioDestinationNode | null = null;
  private recorder: MediaRecorder | null = null;
  private rafId: number | null = null;
  private mimeType = '';

  constructor(options: AudioCaptureOptions = {}) {
    this.options = {
      source: options.source ?? 'microphone',
      timeSliceMs: options.timeSliceMs ?? 1000,
      ...options,
    };
  }

  getStatus(): CaptureStatus {
    return this.status;
  }

  getMimeType(): string {
    return this.mimeType;
  }

  private setStatus(status: CaptureStatus) {
    this.status = status;
    this.options.onStatus?.(status);
  }

  private fail(message: string) {
    this.options.onError?.(message);
    this.setStatus('error');
    this.cleanup();
  }

  /** Acquire the requested media stream(s). */
  private async acquireStreams(): Promise<MediaStream[]> {
    const media = navigator.mediaDevices;
    if (!media?.getUserMedia) {
      throw new Error('This browser does not support audio capture.');
    }

    const streams: MediaStream[] = [];
    const { source } = this.options;

    if (source === 'microphone' || source === 'both') {
      streams.push(
        await media.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        }),
      );
    }

    if (source === 'tab' || source === 'both') {
      if (!media.getDisplayMedia) {
        throw new Error('Tab audio capture is not supported in this browser.');
      }
      // Video is required so the browser shows the tab picker; we drop it after.
      const display = await media.getDisplayMedia({
        video: true,
        audio: true,
      });
      display.getVideoTracks().forEach((t) => t.stop());
      if (display.getAudioTracks().length === 0) {
        display.getTracks().forEach((t) => t.stop());
        throw new Error(
          'No tab audio captured. Pick a tab and enable "Share tab audio".',
        );
      }
      streams.push(display);
    }

    return streams;
  }

  async start(): Promise<void> {
    if (this.status === 'listening' || this.status === 'requesting') return;
    this.mimeType = pickMimeType();
    if (!this.mimeType) {
      this.fail('Audio recording is not supported in this browser.');
      return;
    }

    this.setStatus('requesting');

    try {
      this.rawStreams = await this.acquireStreams();
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Permission denied for audio capture.'
          : err instanceof Error
            ? err.message
            : 'Could not start audio capture.';
      this.fail(message);
      return;
    }

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioContext = new AudioCtx();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 1024;
      this.destination = this.audioContext.createMediaStreamDestination();

      // Route every source into both the analyser (metering) and the
      // recorder destination (mixing). The analyser is intentionally NOT
      // connected to the speakers to avoid feedback/echo.
      for (const stream of this.rawStreams) {
        if (stream.getAudioTracks().length === 0) continue;
        const node = this.audioContext.createMediaStreamSource(stream);
        node.connect(this.analyser);
        node.connect(this.destination);
        // If the user stops sharing from the browser UI, stop everything.
        stream.getAudioTracks().forEach((track) => {
          track.addEventListener('ended', () => this.stop());
        });
      }

      this.recorder = new MediaRecorder(this.destination.stream, {
        mimeType: this.mimeType,
      });
      this.recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          this.options.onChunk?.(event.data);
        }
      };
      this.recorder.start(this.options.timeSliceMs);

      this.setStatus('listening');
      this.startMetering();
    } catch (err) {
      this.fail(
        err instanceof Error ? err.message : 'Failed to initialize audio pipeline.',
      );
    }
  }

  private startMetering() {
    if (!this.analyser) return;
    const buffer = new Uint8Array(this.analyser.fftSize);

    const tick = () => {
      if (!this.analyser) return;
      this.analyser.getByteTimeDomainData(buffer);
      // RMS around the 128 midpoint, normalized to ~0..1.
      let sumSquares = 0;
      for (let i = 0; i < buffer.length; i++) {
        const deviation = (buffer[i] - 128) / 128;
        sumSquares += deviation * deviation;
      }
      const rms = Math.sqrt(sumSquares / buffer.length);
      const level = Math.min(1, rms * 2.5);
      this.options.onLevel?.(level);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private cleanup() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.recorder = null;
    this.rawStreams.forEach((stream) =>
      stream.getTracks().forEach((track) => track.stop()),
    );
    this.rawStreams = [];
    this.analyser = null;
    this.destination = null;
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined);
      this.audioContext = null;
    }
    this.options.onLevel?.(0);
  }

  stop(): void {
    if (this.recorder && this.recorder.state !== 'inactive') {
      try {
        this.recorder.stop();
      } catch {
        /* already stopped */
      }
    }
    this.cleanup();
    if (this.status !== 'error') this.setStatus('idle');
  }
}
