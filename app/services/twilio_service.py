from app.config import get_settings

def build_stream_twiml() -> str:
    """
    Returns TwiML that:
    1. Greets the caller briefly
    2. Connects the call audio to our WebSocket media stream
    """
    settings = get_settings()
    ws_url = settings.app_base_url.replace("https://", "wss://").replace("http://", "ws://")
    stream_url = f"{ws_url}/media-stream"

    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">
    Please hold while we connect you to our virtual assistant.
  </Say>
  <Connect>
    <Stream url="{stream_url}" />
  </Connect>
</Response>"""