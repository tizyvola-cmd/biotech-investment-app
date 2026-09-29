"""Confirmation gate: unverified hypotheses must never carry a price-derived EIS."""
from __future__ import annotations

import sys
from datetime import date
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))

from prediction.eis_feed_quality import (  # noqa: E402
    ANTICIPATED,
    CONFIRMED,
    classify_event_confirmation,
    event_has_hard_source,
    gate_event_confirmation,
    neutralize_anticipated_event_score,
)

AS_OF = date(2026, 9, 1)


def _ev(**kw):
    base = {
        "event_title": "Phase 2 topline readout",
        "summary": "ORR 38% (n=42, p=0.01).",
        "source_type": "publication",
        "link": "",
    }
    base.update(kw)
    return base


class TestHardSource:
    def test_url_counts(self):
        assert event_has_hard_source(_ev(link="https://pubmed.ncbi.nlm.nih.gov/12345678/"))

    def test_doi_pmid_nct_count(self):
        assert event_has_hard_source(_ev(link="10.1056/NEJMoa2034577"))
        assert event_has_hard_source(_ev(link="PMID: 39102345"))
        assert event_has_hard_source(_ev(link="NCT04198766"))

    def test_verified_sec_filing_counts(self):
        assert event_has_hard_source(_ev(link="", sec_filing_verified=True))

    def test_empty_link_does_not(self):
        assert not event_has_hard_source(_ev(link=""))


class TestClassification:
    def test_real_event_with_source_is_confirmed(self):
        ev = _ev(event_date="2026-06-01", link="https://example.com/pr")
        assert classify_event_confirmation(ev, as_of=AS_OF)["status"] == CONFIRMED

    def test_hedged_title_without_source_is_anticipated(self):
        ev = _ev(
            event_title="Potential ESMO 2026 data presentation for INBRX-106",
            event_date="2026-09-01",
        )
        v = classify_event_confirmation(ev, as_of=AS_OF)
        assert v["status"] == ANTICIPATED
        assert v["reason"] == "hedged_claim"

    def test_self_disclaimed_body_is_anticipated(self):
        ev = _ev(
            event_title="ASCO 2024 — OX40 agonist landscape context",
            summary="Based on training knowledge; specific figures are not yet publicly available.",
            event_date="2024-06-01",
        )
        v = classify_event_confirmation(ev, as_of=AS_OF)
        assert v["status"] == ANTICIPATED
        assert v["reason"] == "self_disclaimed"

    def test_future_dated_without_source_is_anticipated(self):
        ev = _ev(event_title="Litifilimab Phase 3 completion", event_date="2026-09-27")
        v = classify_event_confirmation(ev, as_of=AS_OF)
        assert v["status"] == ANTICIPATED
        assert v["reason"] == "future_dated"

    def test_real_earnings_are_not_swept_up(self):
        """A dated earnings report is a fact even when the body discusses what is expected."""
        ev = _ev(
            event_title="InspireMD Q2 2026 earnings — CGuard revenue and enrollment update",
            summary="Revenue of $2.1M; pivotal readout expected later this year.",
            source_type="press_release",
            event_date="2026-08-14",
        )
        assert classify_event_confirmation(ev, as_of=AS_OF)["status"] == CONFIRMED

    def test_hedged_title_with_real_source_stays_confirmed(self):
        ev = _ev(
            event_title="Potential accelerated approval discussed in 8-K",
            event_date="2026-05-01",
            link="https://sec.gov/filing/123",
        )
        assert classify_event_confirmation(ev, as_of=AS_OF)["status"] == CONFIRMED

    def test_model_declaration_wins(self):
        ev = _ev(
            event_date="2026-01-05",
            link="https://example.com/pr",
            confirmation_status="anticipated",
        )
        v = classify_event_confirmation(ev, as_of=AS_OF)
        assert v["status"] == ANTICIPATED
        assert v["reason"] == "declared_by_model"

    def test_expected_window_derived_from_event_date(self):
        ev = _ev(event_title="Potential AACR 2026 poster", event_date="2026-04-01")
        v = classify_event_confirmation(ev, as_of=AS_OF)
        assert v["expected_window_start"] == "2026-03-02"
        assert v["expected_window_end"] == "2026-05-31"

    def test_explicit_window_is_kept(self):
        ev = _ev(
            event_title="Potential AACR 2026 poster",
            event_date="2026-04-01",
            expected_window_start="2026-04-10",
            expected_window_end="2026-04-15",
        )
        v = classify_event_confirmation(ev, as_of=AS_OF)
        assert v["expected_window_start"] == "2026-04-10"
        assert v["expected_window_end"] == "2026-04-15"


class TestNeutralization:
    def test_price_and_score_are_stripped(self):
        ev = _ev(
            eis={"score": 5.31, "delta_p_1d": 10.89},
            price={"delta_p_1d": 10.89, "delta_p_3d": 3.94},
        )
        out = neutralize_anticipated_event_score(ev)
        assert out["eis"] is None
        assert out["eis_gated"] == "unverified_hypothesis"
        assert out["price"]["delta_p_1d"] is None

    def test_gate_neutralizes_hypotheses_only(self):
        hypothesis = gate_event_confirmation(
            _ev(event_title="Potential ASCO 2026 abstract", eis={"score": 4.4}),
            as_of=AS_OF,
        )
        assert hypothesis["eis"] is None
        assert hypothesis["confirmation_status"] == ANTICIPATED

        real = gate_event_confirmation(
            _ev(event_date="2026-06-01", link="https://example.com/x", eis={"score": 4.4}),
            as_of=AS_OF,
        )
        assert real["eis"] == {"score": 4.4}
        assert real["confirmation_status"] == CONFIRMED

    def test_gate_is_idempotent(self):
        ev = _ev(event_title="Potential ASCO 2026 abstract", eis={"score": 4.4})
        once = gate_event_confirmation(ev, as_of=AS_OF)
        twice = gate_event_confirmation(once, as_of=AS_OF)
        assert once == twice


class TestVerifierHelpers:
    def test_pubmed_date_formats(self):
        from prediction.eis_hypothesis_verifier import _parse_pubmed_date

        assert _parse_pubmed_date("2024/02/01 00:00") == "2024-02-01"
        assert _parse_pubmed_date("2023 Oct 25") == "2023-10-25"
        assert _parse_pubmed_date("2024 Feb") is None  # year+month is not day precision
        assert _parse_pubmed_date("") is None

    def test_reviews_are_not_evidence(self):
        from prediction.eis_hypothesis_verifier import (
            _REVIEW_ABSTRACT_RE,
            _REVIEW_TITLE_RE,
        )

        assert _REVIEW_TITLE_RE.search("Emerging biologic therapies: a review")
        # Neutral title, review declared only in the abstract.
        assert not _REVIEW_TITLE_RE.search("The development of litifilimab for lupus")
        assert _REVIEW_ABSTRACT_RE.search(
            "This review describes the litifilimab development program to date."
        )
        assert not _REVIEW_ABSTRACT_RE.search(
            "In this Phase 3 trial, litifilimab met the primary endpoint (p=0.001)."
        )

    def test_ai_answer_without_a_source_is_discarded(self, monkeypatch):
        import ai_provider

        from prediction import eis_hypothesis_verifier as verifier

        monkeypatch.setattr(ai_provider, "is_available", lambda: True)
        monkeypatch.setattr(
            ai_provider,
            "call_ai",
            lambda *a, **k: '{"found": true, "link": "", "event_date": "2026-06-01",'
            ' "title": "ASCO 2026 poster", "summary": "ORR 40%"}',
        )
        item = {
            "ticker": "NRIX",
            "company": "Nurix",
            "title": "Potential ASCO 2026 abstract",
            "created_at": "2026-01-01T00:00:00",
            "expected_window_start": "2026-05-01",
            "expected_window_end": "2026-06-30",
        }
        assert verifier._ai_evidence(item, as_of=AS_OF) is None

    def test_ai_answer_with_a_real_source_is_accepted(self, monkeypatch):
        import ai_provider

        from prediction import eis_hypothesis_verifier as verifier

        monkeypatch.setattr(ai_provider, "is_available", lambda: True)
        monkeypatch.setattr(
            ai_provider,
            "call_ai",
            lambda *a, **k: '{"found": true, "link": "https://ascopubs.org/doi/10.1200/x",'
            ' "event_date": "2026-06-01", "title": "ASCO 2026 poster", "summary": "ORR 40%"}',
        )
        item = {
            "ticker": "NRIX",
            "company": "Nurix",
            "title": "Potential ASCO 2026 abstract",
            "created_at": "2026-01-01T00:00:00",
            "expected_window_start": "2026-05-01",
            "expected_window_end": "2026-06-30",
        }
        out = verifier._ai_evidence(item, as_of=AS_OF)
        assert out is not None
        assert out["event_date"] == "2026-06-01"

    def test_ai_cannot_confirm_something_in_the_future(self, monkeypatch):
        import ai_provider

        from prediction import eis_hypothesis_verifier as verifier

        monkeypatch.setattr(ai_provider, "is_available", lambda: True)
        monkeypatch.setattr(
            ai_provider,
            "call_ai",
            lambda *a, **k: '{"found": true, "link": "https://example.com/a",'
            ' "event_date": "2027-01-01", "title": "t", "summary": "s"}',
        )
        item = {"ticker": "X", "company": "X", "title": "t", "created_at": "2026-01-01T00:00:00"}
        assert verifier._ai_evidence(item, as_of=AS_OF) is None


class TestPendingRegistry:
    @staticmethod
    def _registry(tmp_path, monkeypatch):
        import prediction.eis_pending_verification as reg

        monkeypatch.setattr(reg, "_DATA_DIR", tmp_path)
        monkeypatch.setattr(reg, "_STORE_PATH", tmp_path / "eis_pending_verification.json")
        return reg

    def test_only_hypotheses_are_queued(self, tmp_path, monkeypatch):
        reg = self._registry(tmp_path, monkeypatch)
        events = [
            _ev(event_title="Potential AACR 2026 poster", event_date="2026-04-01"),
            _ev(event_date="2026-04-02", link="https://example.com/pr"),
        ]
        stats = reg.upsert_hypotheses(events, ticker="nrix", company="Nurix")
        assert stats == {"added": 1, "updated": 0, "total": 1}
        item = reg.load_registry()["items"][0]
        assert item["ticker"] == "NRIX"
        assert item["status"] == reg.STATUS_PENDING
        assert item["expected_window_end"] == "2026-05-31"

    def test_reemitting_the_same_hypothesis_does_not_duplicate(self, tmp_path, monkeypatch):
        reg = self._registry(tmp_path, monkeypatch)
        ev = _ev(event_title="Potential AACR 2026 poster", event_date="2026-04-01")
        reg.upsert_hypotheses([ev], ticker="NRIX")
        stats = reg.upsert_hypotheses([ev], ticker="NRIX")
        assert stats == {"added": 0, "updated": 1, "total": 1}

    def test_confirmed_items_are_not_reopened(self, tmp_path, monkeypatch):
        reg = self._registry(tmp_path, monkeypatch)
        ev = _ev(event_title="Potential AACR 2026 poster", event_date="2026-04-01")
        reg.upsert_hypotheses([ev], ticker="NRIX")
        hid = reg.load_registry()["items"][0]["id"]
        reg.apply_outcomes({hid: {"status": reg.STATUS_CONFIRMED, "resolution": {"link": "x"}}})
        reg.upsert_hypotheses([ev], ticker="NRIX")
        assert reg.load_registry()["items"][0]["status"] == reg.STATUS_CONFIRMED

    def test_check_waits_for_the_window_then_expires(self, tmp_path, monkeypatch):
        reg = self._registry(tmp_path, monkeypatch)
        item = {
            "status": reg.STATUS_PENDING,
            "expected_window_start": "2026-06-01",
            "expected_window_end": "2026-06-30",
        }
        assert not reg.is_due_for_check(item, as_of=date(2026, 3, 1))
        assert reg.is_due_for_check(item, as_of=date(2026, 5, 20))  # inside the lead
        assert not reg.is_expired(item, as_of=date(2026, 7, 1))
        assert reg.is_expired(item, as_of=date(2026, 9, 1))

    def test_cooldown_blocks_rechecking(self, tmp_path, monkeypatch):
        reg = self._registry(tmp_path, monkeypatch)
        item = {
            "status": reg.STATUS_PENDING,
            "expected_window_start": "2026-06-01",
            "last_checked_at": "2026-06-10T08:00:00",
        }
        assert not reg.is_due_for_check(item, as_of=date(2026, 6, 12))
        assert reg.is_due_for_check(item, as_of=date(2026, 6, 12), force=True)
        assert reg.is_due_for_check(item, as_of=date(2026, 6, 25))
