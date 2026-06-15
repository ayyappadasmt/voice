from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    # --- Gemini (required) ---
    gemini_api_key: str
    # Native-audio Live model used for the real-time spoken interface.
    gemini_model: str = "gemini-2.5-flash-native-audio-latest"
    gemini_voice: str = "Aoede"

    # --- Twilio (optional — only needed for the phone/V2V channel) ---
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_phone_number: str | None = None
    validate_twilio_signature: bool = True

    # --- App ---
    # Public base URL (https://...) used by the Twilio phone channel.
    app_base_url: str = "http://localhost:8000"

    # Optional token validated before the Twilio media stream connects to Gemini.
    stream_auth_token: str = ""

    # Shared secret company staff use to manage the knowledge base.
    staff_api_key: str = "changeme"

    # Comma-separated list of allowed CORS origins (the Next.js app origin).
    cors_allowed_origins: str = "*"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        origins = [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]
        return origins or ["*"]


@lru_cache()
def get_settings() -> Settings:
    return Settings()
