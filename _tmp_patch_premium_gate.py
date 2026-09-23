from pathlib import Path

p = Path(r"c:\coding\Biotech_Investment app 6\supernova_api.py")
text = p.read_text(encoding="utf-8")
old = '''    @application.post("/api/catalyst-interest")
    async def catalyst_interest_post(request: Request) -> dict[str, Any]:
        """
        Enroll a ticker of interest: watchlist + calendar roster (if CIK known) +
        optional manual CD sidecar + clinical/Daily News kicks.
        Body: {ticker, company?, cd_iso|cd_date?, nct_id?, note?, open_pipeline?}
        """
        from catalyst_interest import enroll_interest_ticker

        body = await _request_json_dict(request)
        return _json_safe(enroll_interest_ticker(body if isinstance(body, dict) else {}))
'''
new = '''    @application.post("/api/catalyst-interest")
    async def catalyst_interest_post(request: Request) -> dict[str, Any]:
        """
        Enroll a ticker of interest: watchlist + calendar roster (if CIK known) +
        optional manual CD sidecar + clinical/Daily News kicks.
        Body: {ticker, company?, cd_iso|cd_date?, nct_id?, note?, open_pipeline?}
        Requires admin API token OR approved premium tester session.
        """
        from catalyst_interest import enroll_interest_ticker
        import tester_feedback_io as tf

        if not _request_has_admin_token(request):
            sess = request.headers.get(tf.TESTER_SESSION_HEADER) or request.headers.get(
                "x-supernova-tester-session"
            )
            tid = tf.find_tester_id_by_session(sess)
            if not tid:
                raise HTTPException(
                    status_code=401,
                    detail="Premium membership required to enroll companies of interest",
                )
            access = tf.get_tester_access(tid)
            if not access.get("premium"):
                raise HTTPException(
                    status_code=403,
                    detail="Premium membership required to enroll companies of interest",
                )

        body = await _request_json_dict(request)
        return _json_safe(enroll_interest_ticker(body if isinstance(body, dict) else {}))
'''
if old not in text:
    raise SystemExit("old block not found")
p.write_text(text.replace(old, new, 1), encoding="utf-8")
print("catalyst-interest patched")

# Insert premium endpoint after status endpoint
marker = '''    @application.post("/api/tester-feedback/testers/{tester_id}/status")
    async def tester_feedback_set_status(tester_id: str, body: dict[str, Any]) -> dict[str, Any]:
        import tester_feedback_io as tf

        status = body.get("status")
        if not isinstance(status, str) or not status.strip():
            raise HTTPException(status_code=400, detail="status richiesto (pending|approved|revoked)")
        note = body.get("note") if isinstance(body.get("note"), str) else None
        try:
            meta = tf.set_tester_status(tester_id, status, note=note)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, "tester": meta})
'''
premium_ep = '''    @application.post("/api/tester-feedback/testers/{tester_id}/status")
    async def tester_feedback_set_status(tester_id: str, body: dict[str, Any]) -> dict[str, Any]:
        import tester_feedback_io as tf

        status = body.get("status")
        if not isinstance(status, str) or not status.strip():
            raise HTTPException(status_code=400, detail="status richiesto (pending|approved|revoked)")
        note = body.get("note") if isinstance(body.get("note"), str) else None
        try:
            meta = tf.set_tester_status(tester_id, status, note=note)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, "tester": meta})

    @application.post("/api/tester-feedback/testers/{tester_id}/premium")
    async def tester_feedback_set_premium(tester_id: str, body: dict[str, Any]) -> dict[str, Any]:
        """Grant / revoke premium (Calendar, Discovery, interest enroll). Owner always premium."""
        import tester_feedback_io as tf

        premium = body.get("premium")
        if not isinstance(premium, bool):
            raise HTTPException(status_code=400, detail="premium bool richiesto")
        try:
            meta = tf.set_tester_premium(tester_id, premium)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        return _json_safe({"ok": True, "tester": meta})
'''
text2 = p.read_text(encoding="utf-8")
if "/premium\")" in text2 and "tester_feedback_set_premium" in text2:
    print("premium endpoint already present")
elif marker not in text2:
    raise SystemExit("status marker not found")
else:
    p.write_text(text2.replace(marker, premium_ep, 1), encoding="utf-8")
    print("premium endpoint added")
