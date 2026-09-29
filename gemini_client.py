"""
Gemini Flash client — free-tier internal AI for SuperNova (google-genai SDK).

Setup:
  pip install -U google-genai
  GEMINI_API_KEY from https://aistudio.google.com/apikey
  Optional GEMINI_MODEL (default: gemini-flash-lite-latest)

Used by ``ai_provider`` when provider == ``gemini``. Soft BUY/SELL unchanged.
"""
from __future__ import annotations

import os
import re
import time
from typing import Any, Callable

# Prefer lite aliases — full "flash-latest" / 3.x flash often return empty text
# or 503 for new AI Studio keys; lite models answer reliably on free tier.
_DEFAULT_MODEL = "gemini-flash-lite-latest"
_FALLBACK_MODELS = (
    "gemini-flash-lite-latest",
    "gemini-3.5-flash-lite",
    "gemini-flash-latest",
)
# A per-day quota does not refill between retries — backing off only makes the
# caller wait minutes for the same rejection.
_PER_DAY_QUOTA_RE = re.compile(r"per\s*day|perday|free_tier_requests", re.I)


def _extract_text(resp: Any) -> str:
    """Prefer resp.text; fall back to non-thought candidate parts."""
    direct = getattr(resp, "text", None)
    if isinstance(direct, str) and direct.strip():
        return direct.strip()
    chunks: list[str] = []
    for cand in getattr(resp, "candidates", None) or []:
        content = getattr(cand, "content", None)
        for part in getattr(content, "parts", None) or []:
            if getattr(part, "thought", False):
                continue
            t = getattr(part, "text", None)
            if isinstance(t, str) and t.strip():
                chunks.append(t.strip())
    return "\n".join(chunks).strip()


class GeminiClient:
    """Thin Gemini Flash wrapper with retry on free-tier 429/503s."""

    def __init__(
        self,
        api_key: str | None = None,
        model: str | None = None,
        max_retries: int = 3,
        retry_backoff_seconds: float = 5.0,
    ) -> None:
        self.api_key = (api_key or os.environ.get("GEMINI_API_KEY") or "").strip()
        if not self.api_key:
            raise RuntimeError(
                "Missing Gemini API key. Set GEMINI_API_KEY or pass api_key=. "
                "Get a free key at https://aistudio.google.com/apikey"
            )
        self.model = (
            model
            or os.environ.get("GEMINI_MODEL")
            or _DEFAULT_MODEL
        ).strip()
        self.max_retries = max(1, int(max_retries))
        self.retry_backoff_seconds = float(retry_backoff_seconds)
        try:
            from google import genai
        except ImportError as exc:
            raise RuntimeError(
                "google-genai non installato nel Python dell’API. "
                "Esegui: .venv\\Scripts\\python.exe -m pip install google-genai "
                "e riavvia l’API (python -m supernova_api)."
            ) from exc

        self.client = genai.Client(api_key=self.api_key)

    def complete(
        self,
        prompt: str,
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = 2048,
    ) -> str:
        from google.genai import types

        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
        return self._generate(prompt, config)

    def chat(
        self,
        messages: list[dict[str, str]],
        system_instruction: str | None = None,
        temperature: float = 0.3,
        max_output_tokens: int = 2048,
    ) -> str:
        from google.genai import types

        contents = []
        for m in messages:
            role = str(m.get("role") or "user").strip().lower()
            if role == "assistant":
                role = "model"
            if role not in ("user", "model"):
                role = "user"
            contents.append(
                types.Content(
                    role=role,
                    parts=[types.Part(text=str(m.get("content") or ""))],
                )
            )
        config = types.GenerateContentConfig(
            system_instruction=system_instruction,
            temperature=temperature,
            max_output_tokens=max_output_tokens,
        )
        return self._generate(contents, config)

    def _generate(self, contents: Any, config: Any) -> str:
        models: list[str] = []
        for m in (self.model, *_FALLBACK_MODELS):
            if m and m not in models:
                models.append(m)
        last_err: Exception | None = None
        for model in models:
            try:
                resp = self._call_with_retry(
                    lambda m=model: self.client.models.generate_content(
                        model=m,
                        contents=contents,
                        config=config,
                    )
                )
                text = _extract_text(resp)
                if text:
                    self.model = model
                    return text
                last_err = RuntimeError(f"{model}: empty response")
            except Exception as exc:
                last_err = exc
                continue
        if last_err:
            raise last_err
        return ""

    def _call_with_retry(self, fn: Callable[[], Any]) -> Any:
        from google.genai.errors import ClientError, ServerError

        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                return fn()
            except (ClientError, ServerError) as e:
                last_error = e
                code = getattr(e, "code", None)
                low = str(e).lower()
                retryable = code in (429, 503) or "429" in low or "503" in low or "unavailable" in low
                if _PER_DAY_QUOTA_RE.search(str(e)):
                    raise
                if retryable and attempt < self.max_retries:
                    time.sleep(self.retry_backoff_seconds * attempt)
                    continue
                raise
            except Exception as e:
                last_error = e
                low = str(e).lower()
                if _PER_DAY_QUOTA_RE.search(str(e)):
                    raise
                if (
                    "429" in low
                    or "503" in low
                    or "resource_exhausted" in low
                    or "unavailable" in low
                ) and attempt < self.max_retries:
                    time.sleep(self.retry_backoff_seconds * attempt)
                    continue
                raise
        if last_error:
            raise last_error
        raise RuntimeError("Gemini call failed with no error")
