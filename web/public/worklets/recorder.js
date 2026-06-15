// Captures microphone audio frames (Float32, mono) and forwards them to the
// main thread, which converts to 16-bit PCM and streams to the backend.
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      // Copy: the underlying buffer is reused by the audio engine.
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}

registerProcessor("recorder-processor", RecorderProcessor);
