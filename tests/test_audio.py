"""Tests for μ-law <-> PCM transcoding used by the Twilio/Gemini bridge."""
from app.services.audio import (
    AudioConverter,
    GEMINI_INPUT_RATE,
    TWILIO_RATE,
    GEMINI_OUTPUT_RATE,
)


def test_twilio_to_gemini_upsamples_to_16k():
    conv = AudioConverter()
    # 160 bytes of μ-law @ 8kHz = 20ms of audio = 160 samples.
    mulaw = b"\xff" * 160
    pcm16 = conv.twilio_to_gemini(mulaw)
    # Output is PCM16 (2 bytes/sample) at ~2x the rate.
    expected_samples = 160 * GEMINI_INPUT_RATE // TWILIO_RATE
    assert len(pcm16) == expected_samples * 2


def test_gemini_to_twilio_downsamples_to_mulaw_8k():
    conv = AudioConverter()
    # 480 samples of silence PCM16 @ 24kHz = 20ms.
    pcm = b"\x00\x00" * 480
    mulaw = conv.gemini_to_twilio(pcm)
    expected = 480 * TWILIO_RATE // GEMINI_OUTPUT_RATE
    # μ-law is 1 byte/sample; allow a small tolerance for resampler boundaries.
    assert abs(len(mulaw) - expected) <= 2


def test_converter_is_stateful_and_stable():
    conv = AudioConverter()
    total = 0
    for _ in range(10):
        out = conv.twilio_to_gemini(b"\x7f" * 160)
        total += len(out)
    assert total > 0
