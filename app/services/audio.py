"""
Audio transcoding between Twilio Media Streams and the Gemini Live API.

Twilio Media Streams use G.711 μ-law, 8 kHz, mono, base64-encoded.
Gemini Live expects 16-bit signed PCM, 16 kHz mono input and returns
16-bit signed PCM at 24 kHz mono output.

We therefore convert:
  inbound : μ-law 8 kHz   -> PCM16 16 kHz   (caller -> Gemini)
  outbound: PCM16 24 kHz  -> μ-law 8 kHz    (Gemini -> caller)

``audioop`` is part of the standard library on Python <= 3.12 and is provided
by the ``audioop-lts`` backport on Python >= 3.13.
"""
try:  # pragma: no cover - import shim
    import audioop  # type: ignore
except ModuleNotFoundError:  # pragma: no cover - Python 3.13+
    import audioop_lts as audioop  # type: ignore

TWILIO_RATE = 8000
GEMINI_INPUT_RATE = 16000
GEMINI_OUTPUT_RATE = 24000
SAMPLE_WIDTH = 2  # 16-bit PCM


class AudioConverter:
    """Stateful resampler. Keep one instance per call/direction."""

    def __init__(self) -> None:
        self._upsample_state = None
        self._downsample_state = None

    def twilio_to_gemini(self, mulaw_bytes: bytes) -> bytes:
        """μ-law 8 kHz -> PCM16 16 kHz."""
        pcm8 = audioop.ulaw2lin(mulaw_bytes, SAMPLE_WIDTH)
        pcm16, self._upsample_state = audioop.ratecv(
            pcm8, SAMPLE_WIDTH, 1, TWILIO_RATE, GEMINI_INPUT_RATE, self._upsample_state
        )
        return pcm16

    def gemini_to_twilio(self, pcm_bytes: bytes) -> bytes:
        """PCM16 24 kHz -> μ-law 8 kHz."""
        pcm8, self._downsample_state = audioop.ratecv(
            pcm_bytes, SAMPLE_WIDTH, 1, GEMINI_OUTPUT_RATE, TWILIO_RATE, self._downsample_state
        )
        return audioop.lin2ulaw(pcm8, SAMPLE_WIDTH)
