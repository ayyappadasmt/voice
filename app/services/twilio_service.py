from xml.sax.saxutils import quoteattr

from app.config import get_settings


def build_stream_twiml() -> str:
    """
    Returns TwiML that:
    1. Greets the caller briefly
    2. Connects the call audio to our WebSocket media stream

    When a stream auth token is configured it is passed as a Twilio
    <Parameter>, which arrives in the stream's ``start`` event so the bridge
    can authorize the connection before talking to Gemini.
    """
    settings = get_settings()
    ws_url = settings.app_base_url.replace("https://", "wss://").replace("http://", "ws://")
    stream_url = f"{ws_url.rstrip('/')}/media-stream"

    param = ""
    if settings.stream_auth_token:
        # quoteattr returns a value wrapped in double quotes, safely escaped.
        param = f"\n    <Parameter name=\"token\" value={quoteattr(settings.stream_auth_token)} />"

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">
    Please hold while we connect you to our virtual assistant.
  </Say>
  <Connect>
    <Stream url={quoteattr(stream_url)}>{param}
    </Stream>
  </Connect>
</Response>"""
