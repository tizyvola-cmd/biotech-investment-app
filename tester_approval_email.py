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
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse, urlunparse
from html import escape as html_escape

_log = logging.getLogger(__name__)

_PROFILE_ENV_CACHE: dict[str, str] | None = None


def _profile_env_files() -> list[Path]:
    root = Path(__file__).resolve().parent
    files: list[Path] = []
    for name in ("config/profiles/desktop_web_host.env", "config/profiles/desktop_web_host.local.env"):
        path = root / name
        if path.is_file():
            files.append(path)
    return files


def _load_profile_env() -> dict[str, str]:
    global _PROFILE_ENV_CACHE
    if _PROFILE_ENV_CACHE is not None:
        return _PROFILE_ENV_CACHE
    vals: dict[str, str] = {}
    for path in _profile_env_files():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            vals[key.strip()] = value.strip()
    _PROFILE_ENV_CACHE = vals
    return vals


def _env_or_profile(name: str) -> str:
    raw = os.environ.get(name, "").strip()
    if raw:
        return raw
    return _load_profile_env().get(name, "").strip()


@dataclass(frozen=True)
class ApprovalEmailResult:
    ok: bool
    skipped: bool = False
    reason: str | None = None
    to: str | None = None


def smtp_configured() -> bool:
    host = _env_or_profile("SUPERNOVA_SMTP_HOST")
    user = _env_or_profile("SUPERNOVA_SMTP_USER")
    return bool(host and user)


def mobile_public_url() -> str | None:
    raw = _env_or_profile("SUPERNOVA_MOBILE_PUBLIC_URL")
    if raw:
        return raw.rstrip("/")
    base = _env_or_profile("SUPERNOVA_PUBLIC_BASE_URL").rstrip("/")
    if base:
        if base.endswith("/mobile"):
            return base
        return f"{base}/mobile"
    host = _env_or_profile("SUPERNOVA_PUBLIC_HOST")
    if host:
        port = _env_or_profile("SUPERNOVA_PORT") or "8765"
        scheme = _env_or_profile("SUPERNOVA_PUBLIC_SCHEME") or "http"
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


def desktop_public_url() -> str | None:
    """Root web URL for desktop landing (Request Access / Sign-in)."""
    base = _env_or_profile("SUPERNOVA_PUBLIC_BASE_URL").rstrip("/")
    if base:
        if base.endswith("/mobile"):
            base = base[: -len("/mobile")]
        return base or None
    host = _env_or_profile("SUPERNOVA_PUBLIC_HOST")
    if host:
        port = _env_or_profile("SUPERNOVA_PORT") or "8765"
        scheme = _env_or_profile("SUPERNOVA_PUBLIC_SCHEME") or "http"
        return f"{scheme}://{host}:{port}"
    return None


def build_desktop_welcome_url(*, email: str | None = None) -> str | None:
    base = desktop_public_url()
    if not base:
        return None
    parsed = urlparse(base)
    q: dict[str, str] = {"welcome": "1"}
    if email:
        q["email"] = email.strip().lower()
    path = (parsed.path or "/").rstrip("/") or "/"
    if not path.endswith("/"):
        path = f"{path}/"
    return urlunparse(
        (parsed.scheme, parsed.netloc, path, parsed.params, urlencode(q), parsed.fragment)
    )


def owner_notify_email() -> str | None:
    raw = _env_or_profile("SUPERNOVA_OWNER_NOTIFY_EMAIL").strip().lower()
    if raw and "@" in raw:
        return raw
    # Default: same as SMTP user / known operator
    user = _env_or_profile("SUPERNOVA_SMTP_USER").strip().lower()
    if user and "@" in user:
        return user
    return "tizyvola@gmail.com"


def gmail_connected_email() -> str:
    """Google mailbox used to notify the owner and reply to applicants."""
    return owner_notify_email() or "tizyvola@gmail.com"


def build_gmail_compose_url(*, to_email: str, subject: str, body: str) -> str:
    q = urlencode(
        {
            "view": "cm",
            "fs": "1",
            "to": (to_email or "").strip(),
            "su": (subject or "").strip()[:180],
            "body": (body or "").strip()[:1800],
        }
    )
    return f"https://mail.google.com/mail/?{q}"


def _edition_label(raw: str | None) -> str:
    key = (raw or "").strip().lower()
    return {
        "biotech": "Biotech",
        "tech": "Tech",
        "both": "Biotech + Tech",
    }.get(key, key or "—")


def _deliver_email(
    *,
    to_addr: str,
    subject: str,
    text: str,
    html: str,
    reply_to: str | None = None,
) -> ApprovalEmailResult:
    if not smtp_configured():
        return ApprovalEmailResult(ok=False, skipped=True, reason="smtp_non_configurato", to=to_addr)

    dry_run = _env_or_profile("SUPERNOVA_SMTP_DRY_RUN") in {"1", "true", "yes"}
    if dry_run:
        _log.info("email (dry-run) to=%s reply_to=%s\n%s", to_addr, reply_to, text)
        return ApprovalEmailResult(ok=True, to=to_addr)

    host = _env_or_profile("SUPERNOVA_SMTP_HOST")
    port = int(_env_or_profile("SUPERNOVA_SMTP_PORT") or "587")
    user = _env_or_profile("SUPERNOVA_SMTP_USER")
    password = _env_or_profile("SUPERNOVA_SMTP_PASSWORD")
    from_addr = _env_or_profile("SUPERNOVA_SMTP_FROM") or user
    use_tls = _env_or_profile("SUPERNOVA_SMTP_USE_TLS") not in {"0", "false", "no"}

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    if reply_to:
        msg["Reply-To"] = reply_to
    msg.attach(MIMEText(text, "plain", "utf-8"))
    msg.attach(MIMEText(html, "html", "utf-8"))

    try:
        with smtplib.SMTP(host, port, timeout=30) as smtp:
            if use_tls:
                smtp.starttls()
            if user:
                smtp.login(user, password)
            smtp.sendmail(from_addr, [to_addr], msg.as_string())
    except Exception as exc:
        _log.warning("email failed to=%s: %s", to_addr, exc)
        return ApprovalEmailResult(ok=False, reason=str(exc), to=to_addr)

    _log.info("email sent to=%s subject=%s", to_addr, subject[:80])
    return ApprovalEmailResult(ok=True, to=to_addr)


def send_access_request_to_owner(
    *,
    requester_email: str,
    display_name: str,
    source: str = "desktop",
    interest_edition: str | None = None,
    interest_other: str | None = None,
    birth_year: int | None = None,
) -> ApprovalEmailResult:
    """Email the operator when someone clicks Request Access on the landing page."""
    to_addr = owner_notify_email()
    if not to_addr:
        return ApprovalEmailResult(ok=False, skipped=True, reason="owner_email_mancante")
    req = (requester_email or "").strip().lower()
    name = (display_name or req or "User").strip()
    edition = _edition_label(interest_edition)
    other = (interest_other or "").strip() or "—"
    year_label = str(birth_year) if birth_year else "—"
    gmail = gmail_connected_email()
    compose = build_gmail_compose_url(
        to_email=req,
        subject=f"SuperNova — accesso {req}",
        body=f"Ciao {name},\n\n",
    )

    subject = f"SuperNova — Request Access: {req}"
    text = (
        f"Nuova richiesta di accesso a SuperNova.\n\n"
        f"Email: {req}\n"
        f"Nome: {name}\n"
        f"Anno di nascita: {year_label}\n"
        f"Versione: {edition}\n"
        f"Investment spaces: {other}\n"
        f"Sorgente: {source}\n\n"
        f"Rispondi da Gmail ({gmail}) — Reply-To è già l'utente.\n"
        f"Oppure apri: {compose}\n\n"
        f"Tab Access → Approva o Revoca.\n\n"
        f"— SuperNova"
    )
    html = f"""\
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>Nuova <strong>Request Access</strong> a SuperNova.</p>
<ul>
<li><strong>Email:</strong> {html_escape(req)}</li>
<li><strong>Nome:</strong> {html_escape(name)}</li>
<li><strong>Anno di nascita:</strong> {html_escape(year_label)}</li>
<li><strong>Versione:</strong> {html_escape(edition)}</li>
<li><strong>Investment spaces:</strong> {html_escape(other)}</li>
<li><strong>Sorgente:</strong> {html_escape(source)}</li>
</ul>
<p>Rispondi da Gmail (<code>{html_escape(gmail)}</code>) — Reply-To = utente.
<a href="{html_escape(compose)}">Apri risposta in Gmail</a>.</p>
<p>Tab <strong>Access</strong> → Approva o Revoca.</p>
<p style="font-size:12px;color:#888">— SuperNova</p>
</body></html>"""

    return _deliver_email(
        to_addr=to_addr,
        subject=subject,
        text=text,
        html=html,
        reply_to=req,
    )


def send_premium_waitlist_to_owner(*, email: str, position: int) -> ApprovalEmailResult:
    """Email the operator when someone joins the Premium beta waitlist."""
    to_addr = owner_notify_email()
    if not to_addr:
        return ApprovalEmailResult(ok=False, skipped=True, reason="owner_email_mancante")
    req = (email or "").strip().lower()
    pos = max(1, int(position or 0))
    subject = f"SuperNova — Premium waitlist #{pos}: {req}"
    text = (
        f"Nuova iscrizione alla waitlist Premium beta.\n\n"
        f"Email: {req}\n"
        f"Posizione: {pos}\n"
        f"Primi 1000: un anno free, poi EUR 3.99 / mese.\n\n"
        f"Apri SuperNova → tab Access → Premium waitlist → «Dai Premium».\n\n"
        f"— SuperNova"
    )
    html = f"""\
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
<p>Nuova iscrizione alla <strong>waitlist Premium beta</strong>.</p>
<ul>
<li><strong>Email:</strong> {html_escape(req)}</li>
<li><strong>Posizione:</strong> {pos}</li>
<li>Primi 1000: un anno free, poi EUR 3.99 / mese.</li>
</ul>
<p><strong>Azione:</strong> SuperNova → tab <strong>Access</strong> → Premium waitlist →
<strong>Dai Premium</strong> (approva Basic + sblocca Calendar / Discovery).</p>
<p style="font-size:12px;color:#888">— SuperNova</p>
</body></html>"""
    return _deliver_email(
        to_addr=to_addr,
        subject=subject,
        text=text,
        html=html,
        reply_to=req,
    )


def send_owner_reply_to_user(
    *,
    to_email: str,
    subject: str,
    body: str,
) -> ApprovalEmailResult:
    """Owner → applicant, from the connected Google mailbox."""
    email = (to_email or "").strip().lower()
    if not email or "@" not in email:
        return ApprovalEmailResult(ok=False, skipped=True, reason="email_mancante")
    subj = (subject or "").strip()[:180] or "SuperNova"
    text = (body or "").strip()
    if not text:
        return ApprovalEmailResult(ok=False, skipped=True, reason="messaggio_vuoto")
    html = f"""\
<html><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;white-space:pre-wrap">{html_escape(text)}</body></html>"""
    return _deliver_email(
        to_addr=email,
        subject=subj,
        text=text,
        html=html,
        reply_to=gmail_connected_email(),
    )


def send_tester_approval_email(
    *,
    to_email: str,
    display_name: str,
    lang: str = "it",
) -> ApprovalEmailResult:
    email = (to_email or "").strip().lower()
    if not email or "@" not in email:
        return ApprovalEmailResult(ok=False, skipped=True, reason="email_mancante")

    # Prefer desktop landing link; fall back to mobile PWA URL.
    welcome_url = build_desktop_welcome_url(email=email) or build_welcome_url(email=email)
    if not welcome_url:
        return ApprovalEmailResult(ok=False, skipped=True, reason="public_url_mancante")

    if not smtp_configured():
        return ApprovalEmailResult(ok=False, skipped=True, reason="smtp_non_configurato")

    subject, text, html = _compose_messages(
        display_name=display_name,
        welcome_url=welcome_url,
        lang=lang,
    )

    dry_run = _env_or_profile("SUPERNOVA_SMTP_DRY_RUN") in {"1", "true", "yes"}
    if dry_run:
        _log.info(
            "tester approval email (dry-run) to=%s url=%s\n%s",
            email,
            welcome_url,
            text,
        )
        return ApprovalEmailResult(ok=True, to=email)

    host = _env_or_profile("SUPERNOVA_SMTP_HOST")
    port = int(_env_or_profile("SUPERNOVA_SMTP_PORT") or "587")
    user = _env_or_profile("SUPERNOVA_SMTP_USER")
    password = _env_or_profile("SUPERNOVA_SMTP_PASSWORD")
    from_addr = _env_or_profile("SUPERNOVA_SMTP_FROM") or user
    use_tls = _env_or_profile("SUPERNOVA_SMTP_USE_TLS") not in {"0", "false", "no"}

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
        "desktop_public_url": desktop_public_url(),
        "owner_notify_email": owner_notify_email(),
        "gmail_reply_email": gmail_connected_email(),
        "dry_run": _env_or_profile("SUPERNOVA_SMTP_DRY_RUN") in {"1", "true", "yes"},
    }
