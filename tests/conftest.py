import os
import sys

# Add the backend root to Python path so 'app' is findable.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

# Provide required settings BEFORE the app/config is imported so tests are
# self-contained and don't depend on a local .env file.
os.environ.setdefault("TWILIO_ACCOUNT_SID", "ACtest")
os.environ.setdefault("TWILIO_AUTH_TOKEN", "test_auth_token")
os.environ.setdefault("TWILIO_PHONE_NUMBER", "+11234567890")
os.environ.setdefault("GEMINI_API_KEY", "test_gemini_key")
os.environ.setdefault("APP_BASE_URL", "https://test.example.com")
os.environ.setdefault("STAFF_API_KEY", "test-staff-key")
# Skip Twilio signature checks in tests.
os.environ.setdefault("VALIDATE_TWILIO_SIGNATURE", "false")
