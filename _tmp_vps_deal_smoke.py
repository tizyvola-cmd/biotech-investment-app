from daily_news_desk import _run_digest_questionnaire, _brief_from_digest_qa, _seed_financial_deal_evidence

title = (
    "Beta Bionics Announces Partnership to Integrate iLet and mint AID Systems "
    "with Senseonics' Eversense 365 CGM"
)
body = (
    "Beta Bionics collaborating with Senseonics to combine automated insulin delivery "
    "with year-long glucose sensing. Aims to expand hardware compatibility and capture "
    "greater market share. Q4 2026 commercialization timeline. Cash terms not disclosed."
)
qa = _run_digest_questionnaire(title=title, body=body, ticker="BBNX")
brief = _brief_from_digest_qa(qa, ticker="BBNX")
dims = _seed_financial_deal_evidence({}, brief.get("deal_terms"))
print("kind", qa["news_kind"])
print("event", next(a["answer"] for a in qa["answers"] if a["id"] == "news_event_type"))
print("deal", brief.get("deal_terms"))
print("fin", (dims or {}).get("financial"))
