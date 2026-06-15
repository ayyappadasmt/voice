// Browser-side real-time voice client: streams mic audio (PCM16 @ 16 kHz) to
// the backend over WebSocket, plays back the agent's audio (PCM16 @ 24 kHz),
// and surfaces transcripts + tool activity via callbacks.

const INPUT_RATE = 16000;
const OUTPUT_RATE = 24000;
const FLUSH_SECONDS = 0.1; // send ~100ms chunks

export type AgentEvent =
  | { type: "status"; state: string }
  | { type: "transcript"; role: "user" | "assistant"; text: string }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string; result: Record<string, unknown> }
  | { type: "turn_complete" }
  | { type: "interrupted" }
  | { type: "error"; message: string };

type Handlers = {
  onEvent: (e: AgentEvent) => void;
  onOpen?: () => void;
  onClose?: () => void;
  onLevel?: (level: number) => void;
};

function floatTo16BitPCM(input: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(input.length * 2);
  const view = new DataView(buf);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buf;
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk))
    );
  }
  return btoa(binary);
}

function base64ToInt16(b64: string): Int16Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

// Linear resample to 16 kHz for browsers that ignore the requested sample rate.
function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === INPUT_RATE) return input;
  const ratio = inputRate / INPUT_RATE;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const idx = i * ratio;
    const i0 = Math.floor(idx);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const frac = idx - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }
  return out;
}

export class VoiceClient {
  private ws: WebSocket | null = null;
  private inputCtx: AudioContext | null = null;
  private outputCtx: AudioContext | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;

  private pending: number[] = [];
  private inputRate = INPUT_RATE;
  private nextStartTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(private url: string, private handlers: Handlers) {}

  async start(): Promise<void> {
    // Audio contexts (must be created/resumed from a user gesture).
    this.inputCtx = new AudioContext({ sampleRate: INPUT_RATE });
    this.outputCtx = new AudioContext({ sampleRate: OUTPUT_RATE });
    await this.inputCtx.resume();
    await this.outputCtx.resume();
    // Browsers may ignore the requested rate; capture the real one.
    this.inputRate = this.inputCtx.sampleRate;

    this.mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    await this.inputCtx.audioWorklet.addModule("/worklets/recorder.js");
    this.sourceNode = this.inputCtx.createMediaStreamSource(this.mediaStream);
    this.workletNode = new AudioWorkletNode(this.inputCtx, "recorder-processor");
    this.workletNode.port.onmessage = (ev) => this.onMicFrame(ev.data as Float32Array);
    this.sourceNode.connect(this.workletNode);
    // Do not connect worklet to destination (avoid echo / feedback).

    this.openSocket();
  }

  private openSocket() {
    this.ws = new WebSocket(this.url);
    this.ws.onopen = () => this.handlers.onOpen?.();
    this.ws.onclose = () => this.handlers.onClose?.();
    this.ws.onerror = () =>
      this.handlers.onEvent({ type: "error", message: "WebSocket error." });
    this.ws.onmessage = (ev) => this.onServerMessage(ev.data);
  }

  private onMicFrame(frame: Float32Array) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    // Simple input level meter.
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    this.handlers.onLevel?.(Math.sqrt(sum / frame.length));

    for (let i = 0; i < frame.length; i++) this.pending.push(frame[i]);
    const flushSamples = Math.round(this.inputRate * FLUSH_SECONDS);
    while (this.pending.length >= flushSamples) {
      const native = new Float32Array(this.pending.splice(0, flushSamples));
      const resampled = resampleTo16k(native, this.inputRate);
      const b64 = arrayBufferToBase64(floatTo16BitPCM(resampled));
      this.ws.send(JSON.stringify({ type: "audio", data: b64 }));
    }
  }

  private onServerMessage(data: string) {
    let msg: any;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "audio":
        this.enqueueAudio(base64ToInt16(msg.data));
        break;
      case "interrupted":
        this.stopPlayback();
        this.handlers.onEvent({ type: "interrupted" });
        break;
      default:
        this.handlers.onEvent(msg as AgentEvent);
    }
  }

  private enqueueAudio(int16: Int16Array) {
    const ctx = this.outputCtx;
    if (!ctx) return;
    const f32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) f32[i] = int16[i] / 32768;
    const buffer = ctx.createBuffer(1, f32.length, OUTPUT_RATE);
    buffer.getChannelData(0).set(f32);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    this.nextStartTime = Math.max(this.nextStartTime, ctx.currentTime);
    src.start(this.nextStartTime);
    this.nextStartTime += buffer.duration;
    this.sources.add(src);
    src.onended = () => this.sources.delete(src);
  }

  private stopPlayback() {
    this.sources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    this.sources.clear();
    this.nextStartTime = 0;
  }

  sendText(text: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "text", text }));
    }
  }

  async stop(): Promise<void> {
    this.stopPlayback();
    try {
      this.workletNode?.disconnect();
      this.sourceNode?.disconnect();
    } catch {
      /* noop */
    }
    this.mediaStream?.getTracks().forEach((t) => t.stop());
    try {
      this.ws?.close();
    } catch {
      /* noop */
    }
    await this.inputCtx?.close().catch(() => {});
    await this.outputCtx?.close().catch(() => {});
    this.ws = null;
    this.inputCtx = null;
    this.outputCtx = null;
    this.workletNode = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.pending = [];
  }
}
