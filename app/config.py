from pydantic_settings import BaseSettings
from functools import lru_cache

class Settings(BaseSettings):
    twilio_account_sid: str
    twilio_auth_token: str
    twilio_phone_number: str
    gemini_api_key: str
    gemini_model: str = "gemini-2.5-flash-native-audio-latest"
    app_base_url: str
    secret_key: str = "changeme"

    class Config:
        env_file = ".env"

@lru_cache()
def get_settings() -> Settings:
    return Settings()