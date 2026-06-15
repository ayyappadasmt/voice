"""
Security helpers: staff API-key auth for the knowledge admin API and
Twilio request-signature validation for inbound webhooks.
"""
import hmac
import logging

from fastapi import Depends, Header, HTTPException, Request, status
from twilio.request_validator import RequestValidator

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)


def require_staff_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    settings: Settings = Depends(get_settings),
) -> None:
    """
    Dependency that protects knowledge-base management endpoints.
    Staff must send the shared secret in the ``X-API-Key`` header.
    """
    expected = settings.staff_api_key

    # Refuse to run with an insecure default secret.
    if not expected or expected == "changeme":
        logger.error("STAFF_API_KEY is not configured; rejecting admin request.")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Server is not configured for staff access.",
        )

    # Constant-time comparison to avoid timing attacks.
    if not x_api_key or not hmac.compare_digest(x_api_key, expected):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing API key.",
            headers={"WWW-Authenticate": "ApiKey"},
        )


async def validate_twilio_request(
    request: Request,
    settings: Settings = Depends(get_settings),
) -> None:
    """
    Verify that an inbound webhook actually originated from Twilio by checking
    the ``X-Twilio-Signature`` header against the request URL + POST params.
    """
    if not settings.validate_twilio_signature:
        return

    if not settings.twilio_auth_token:
        # Phone channel isn't configured; refuse rather than accept blindly.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Phone channel is not configured.",
        )

    signature = request.headers.get("X-Twilio-Signature", "")
    if not signature:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Missing signature.")

    validator = RequestValidator(settings.twilio_auth_token)

    # Twilio signs the *public* URL it called. Behind proxies the scheme/host
    # may differ, so reconstruct the URL from the configured public base.
    base = settings.app_base_url.rstrip("/")
    url = f"{base}{request.url.path}"
    if request.url.query:
        url = f"{url}?{request.url.query}"

    form = await request.form()
    params = {k: v for k, v in form.items()}

    if not validator.validate(url, params, signature):
        logger.warning("Rejected webhook with invalid Twilio signature for %s", url)
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid signature.")
