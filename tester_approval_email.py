"""
Email di approvazione tester mobile — inviata quando l'admin approva l'accesso.

Config (env):
  SUPERNOVA_MOBILE_PUBLIC_URL  — URL PWA (es. https://host/mobile o http://192.168.1.203:5174)
  SUPERNOVA_SMTP_HOST          — es. smtp.gmail.com
  SUPERNOVA_SMTP_PORT          — default 587
  SUPERNOVA_SMTP_USER
  SUPERNOVA_SMTP_PASSWORD
  SUPERNOVA_SMTP_FROM          — default SUPERNOVA_SMTP_USER
  SUPERNOVA_SMTP_USE_TLS       — default 1
  SUPERNOVA_SMTP_DRY_RUN       — se 1, logga invece di inviare (dev)
"""
from __future__ import annotations

import logging
import os
import smtplib
from dataclasses import dataclass
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse

_log = logging.getLogger(__name__)


@dataclass(frozen=True)
class ApprovalEmailResult:
    ok: bool
    skipped: bool = False
    reason: str | None = None
    to: str | None = None


def smtp_configured() -> bool:
    host = os.environ.get("SUPERNOVA_SMTP_HOST", "").strip()
    user = os.environ.get("SUPERNOVA_SMTP_USER", "").strip()
    return bool(host and user)


def mobile_public_url() -> str | None:
    raw = os.environ.get("SUPERNOVA_MOBILE_PUBLIC_URL", "").strip()
    if raw:
        return raw.rstrip("/")
    base = os.environ.get("SUPERNOVA_PUBLIC_BASE_URL", "").strip().rstrip("/")
    if base:
        if base.endswith("/mobile"):
            return base
        return f"{base}/mobile"
    host = os.environ.get("SUPERNOVA_PUBLIC_HOST", "").strip()
    if host:
        port = os.environ.get("SUPERNOVA_PORT", "8765").strip() or "8765"
        scheme = os.environ.get("SUPERNOVA_PUBLIC_SCHEME", "http").strip() or "http"
        return f"{scheme}://{host}:{port}/mobile"
    return None


def build_welcome_url(*, email: str | None = None) -> str | None:
    base = mobile_public_url()
    if not base:
        return None
    parsed = urlparse(base)
    q: dict[str, str] = {"welcome": "1"}
    if email:
        q["email"] = email.strip().lower()
    query = urlencode(q)
    # Trailing slash obbligatorio: /mobile?… → 404 sul VPS; /mobile/?… → OK.
    path = (parsed.path or "").rstrip("/")
    if not path.endswith("/mobile"):
        path = f"{path}/mobile" if path else "/mobile"
    path = f"{path}/"
    return urlunparse((parsed.scheme, parsed.netloc, path, parsed.params, query, parsed.fragment))


def _compose_messages(
    *,
    display_name: str,
    welcome_url: str,
    lang: str = "it",
) -> tuple[str, str, str]:
    name = (display_name or "Tester").strip() or "Tester"
    if lang == "en":
        subject = "SuperNova — your mobile access is approved"
        text = (
            f"Hi {name},\n\n"
            "Your SuperNova tester access has been approved.\n\n"
            "Open this link on your phone to enter the app and add the icon to your home screen:\n"
            f"{welcome_url}\n\n"
            "iPhone (Safari): Share → Add to Home.\n"
            "Android (Chrome): menu ⋮ → Install app / Add to Home screen.\n\n"
            "— SuperNova"
        )
        html = f"""\
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>Hi {name},</p>
<p>Your <strong>SuperNova</strong> tester access has been approved.</p>
<p><a href="{welcome_url}" style="display:inline-block;padding:12px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Open SuperNova on your phone</a></p>
<p style="font-size:13px;color:#555">Or copy this link:<br><code>{welcome_url}</code></p>
<p style="font-size:13px;color:#555"><strong>iPhone (Safari):</strong> Share → Add to Home.<br>
<strong>Android (Chrome):</strong> menu ⋮ → Install app / Add to Home screen.</p>
<p style="font-size:12px;color:#888">— SuperNova</p>
</body></html>"""
    else:
        subject = "SuperNova — accesso mobile approvato"
        text = (
            f"Ciao {name},\n\n"
            "Il tuo accesso tester a SuperNova è stato approvato.\n\n"
            "Apri questo link dal telefono per entrare nell'app e aggiungere l'icona alla Home:\n"
            f"{welcome_url}\n\n"
            "iPhone (Safari): Condividi → Aggiungi a Home.\n"
            "Android (Chrome): menu ⋮ → Installa app / Aggiungi a schermata Home.\n\n"
            "— SuperNova"
        )
        html = f"""\
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>Ciao {name},</p>
<p>Il tuo accesso tester a <strong>SuperNova</strong> è stato approvato.</p>
<p><a href="{welcome_url}" style="display:inline-block;padding:12px 20px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">Apri SuperNova sul telefono</a></p>
<p style="font-size:13px;color:#555">Oppure copia questo link:<br><code>{welcome_url}</code></p>
<p style="font-size:13px;color:#555"><strong>iPhone (Safari):</strong> Condividi → Aggiungi a Home.<br>
<strong>Android (Chrome):</strong> menu ⋮ → Installa app / Aggiungi a schermata Home.</p>
<p style="font-size:12px;color:#888">— SuperNova</p>
</body></html>"""
    return subject, text, html


def send_tester_approval_email(
    *,
    to_email: str,
    display_name: str,
    lang: str = "it",
) -> ApprovalEmailResult:
    email = (to_email or "").strip().lower()
    if not email or "@" not in email:
        return ApprovalEmailResult(ok=False, skipped=True, reason="email_mancante")

    welcome_url = build_welcome_url(email=email)
    if not welcome_url:
        return ApprovalEmailResult(ok=False, skipped=True, reason="mobile_url_mancante")

    if not smtp_configured():
        return ApprovalEmailResult(ok=False, skipped=True, reason="smtp_non_configurato")

    subject, text, html = _compose_messages(
        display_name=display_name,
        welcome_url=welcome_url,
        lang=lang,
    )

    dry_run = os.environ.get("SUPERNOVA_SMTP_DRY_RUN", "").strip() in {"1", "true", "yes"}
    if dry_run:
        _log.info(
            "tester approval email (dry-run) to=%s url=%s\n%s",
            email,
            welcome_url,
            text,
        )
        return ApprovalEmailResult(ok=True, to=email)

    host = os.environ.get("SUPERNOVA_SMTP_HOST", "").strip()
    port = int(os.environ.get("SUPERNOVA_SMTP_PORT", "587") or "587")
    user = os.environ.get("SUPERNOVA_SMTP_USER", "").strip()
    password = os.environ.get("SUPERNOVA_SMTP_PASSWORD", "").strip()
    from_addr = os.environ.get("SUPERNOVA_SMTP_FROM", "").strip() or user
    use_tls = os.environ.get("SUPERNOVA_SMTP_USE_TLS", "1").strip() not in {"0", "false", "no"}

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = email
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            if use_tls:
                smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.sendmail(from_addr, [email], msg.as_string())
    except Exception as exc:
        _log.warning("tester approval email failed to=%s: %s", email, exc)
        return ApprovalEmailResult(ok=False, reason=str(exc), to=email)

    _log.info("tester approval email sent to=%s", email)
    return ApprovalEmailResult(ok=True, to=email)


def email_config_summary() -> dict[str, Any]:
    return {
        "smtp_configured": smtp_configured(),
        "mobile_public_url": mobile_public_url(),
        "dry_run": os.environ.get("SUPERNOVA_SMTP_DRY_RUN", "").strip() in {"1", "true", "yes"},
    }
