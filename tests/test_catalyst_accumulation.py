from datetime import date

from catalyst_accumulation import (
    build_accumulation_row,
    classify_13d_13g,
    compose_silent_money_headline,
    compute_governance_flag,
    compute_insider_net_buy_30d,
    is_10b5_1_sale,
    normalize_sec_api_form4,
)


def test_excludes_10b5_1_sales():
    row = {
        "transactionType": "S-Sale",
        "acquisitionOrDisposition": "D",
        "comment": "Sale pursuant to Rule 10b5-1 trading plan",
        "securitiesTransacted": 1000,
        "price": 10,
        "transactionDate": "2026-09-01",
        "reportingName": "Jane Doe",
    }
    assert is_10b5_1_sale(row) is True
    out = compute_insider_net_buy_30d([row], today=date(2026, 9, 6))
    assert out["skipped_10b5_1"] == 1
    assert out["insider_net_buy_30d"] is None
    assert out["status"] == "none"


def test_excludes_aff10b5_one_flag():
    row = {
        "transactionCode": "S",
        "acquisitionOrDisposition": "D",
        "aff10b5One": True,
        "securitiesTransacted": 500,
        "price": 8,
        "transactionDate": "2026-09-01",
        "reportingName": "Jane Doe",
    }
    assert is_10b5_1_sale(row) is True


def test_net_buy_and_cluster():
    rows = [
        {
            "transactionType": "P-Purchase",
            "acquisitionOrDisposition": "A",
            "securitiesTransacted": 1000,
            "price": 10,
            "transactionDate": "2026-09-01",
            "reportingName": "Alice Smith",
            "typeOfOwner": "Chief Executive Officer",
        },
        {
            "transactionType": "P-Purchase",
            "acquisitionOrDisposition": "A",
            "securitiesTransacted": 500,
            "price": 12,
            "transactionDate": "2026-09-03",
            "reportingName": "Bob Jones",
            "typeOfOwner": "Chief Medical Officer",
        },
        {
            "transactionType": "S-Sale",
            "acquisitionOrDisposition": "D",
            "securitiesTransacted": 100,
            "price": 11,
            "transactionDate": "2026-09-02",
            "reportingName": "Alice Smith",
        },
    ]
    out = compute_insider_net_buy_30d(rows, today=date(2026, 9, 6))
    assert out["cluster_buy"] is True
    assert out["insider_net_buy_30d"] == 1000 * 10 + 500 * 12 - 100 * 11
    assert out["lead_role"] == "CEO"
    assert out["status"] == "ok"


def test_normalize_sec_api_form4_purchase():
    filings = [
        {
            "accessionNo": "0001",
            "periodOfReport": "2026-09-01",
            "filedAt": "2026-09-02T12:00:00-04:00",
            "aff10b5One": False,
            "linkToFilingDetails": "https://sec.gov/x",
            "reportingOwner": {
                "name": "Alice Smith",
                "relationship": {"isOfficer": True, "officerTitle": "Chief Executive Officer"},
            },
            "nonDerivativeTable": {
                "transactions": [
                    {
                        "transactionDate": "2026-09-01",
                        "coding": {"code": "P"},
                        "amounts": {
                            "shares": 1000,
                            "pricePerShare": 10,
                            "acquiredDisposedCode": "A",
                        },
                    }
                ]
            },
            "footnotes": [],
        }
    ]
    rows = normalize_sec_api_form4(filings)
    assert len(rows) == 1
    assert rows[0]["transactionCode"] == "P"
    assert rows[0]["securitiesTransacted"] == 1000
    insider = compute_insider_net_buy_30d(rows, today=date(2026, 9, 6))
    assert insider["insider_net_buy_30d"] == 10000
    assert insider["lead_role"] == "CEO"


def test_13d_headline_preferred_when_no_form4():
    filing = classify_13d_13g(
        [
            {
                "formType": "SC 13D",
                "filedAt": "2026-08-20",
                "owners": [{"name": "Point72", "amountAsPercent": 6.2}],
                "linkToFilingDetails": "https://sec.gov/13d",
            }
        ],
        today=date(2026, 9, 6),
    )
    assert filing["filing_13d"] is True
    head = compose_silent_money_headline({"buy_count_30d": 0}, filing)
    assert head is not None
    assert head["kind"] == "13d"
    assert "Point72" in head["label"]


def test_governance_requires_item_502():
    events = [
        {
            "items_raw": "Item 5.02",
            "event_title": "CFO resigned",
            "event_date": "2026-08-20",
            "link": "https://sec.gov/x",
        },
        {
            "items_raw": "Item 8.01",
            "event_title": "Other",
            "event_date": "2026-08-25",
        },
    ]
    gov = compute_governance_flag(events, today=date(2026, 9, 6))
    assert gov["governance_flag"] is True
    assert gov["gov_date"] == "2026-08-20"
    assert gov["officer_departure"] is True


def test_governance_from_sec_api_structured():
    events = [
        {
            "ticker": "GRAL",
            "filedAt": "2026-08-18T16:00:00-04:00",
            "cik": "123",
            "accessionNo": "0000123-26-000001",
            "linkToFilingDetails": "https://sec.gov/8k",
            "item5_02": {
                "personnelChanges": [
                    {
                        "type": "departure",
                        "person": {"name": "Jane Roe"},
                        "departureType": "resignation",
                        "positions": ["Chief Medical Officer"],
                    }
                ]
            },
        }
    ]
    gov = compute_governance_flag(events, today=date(2026, 9, 6))
    assert gov["governance_flag"] is True
    assert gov["officer_departure"] is True
    assert "Jane Roe" in (gov["gov_label"] or "")
    assert "left" in (gov["gov_label"] or "").lower()
    assert "CMO" in (gov["gov_label"] or "")
    assert gov["gov_href"]


def test_governance_prefers_officer_left_over_appointment():
    events = [
        {
            "filedAt": "2026-09-01T16:00:00-04:00",
            "items": ["Item 5.02: Departure of Directors or Certain Officers"],
            "item5_02": {
                "personnelChanges": [
                    {
                        "type": "appointment",
                        "person": {"name": "New CFO"},
                        "positions": ["Chief Financial Officer"],
                    },
                    {
                        "type": "departure",
                        "departureType": "other",
                        "person": {"name": "Old CFO"},
                        "positions": ["Chief Financial Officer"],
                    },
                ]
            },
        }
    ]
    gov = compute_governance_flag(events, today=date(2026, 9, 6))
    assert gov["officer_departure"] is True
    assert "Old CFO" in (gov["gov_label"] or "")
    assert "left" in (gov["gov_label"] or "").lower()

def test_row_builder_combines():
    row = build_accumulation_row(
        "GRAL",
        form4_rows=[
            {
                "transactionType": "P-Purchase",
                "acquisitionOrDisposition": "A",
                "securitiesTransacted": 100,
                "price": 20,
                "transactionDate": "2026-09-01",
                "reportingName": "CEO Person",
                "typeOfOwner": "Chief Executive Officer",
            }
        ],
        clinical_events=[],
        today=date(2026, 9, 6),
    )
    assert row["insider_net_buy_30d"] == 2000.0
    assert row["silent_kind"] == "form4"
    assert row["governance_flag"] is False


def test_parse_edgar_form4_xml_purchase():
    from edgar_silent_money import parse_form4_xml

    xml = b"""<?xml version=\"1.0\"?>
    <ownershipDocument>
      <reportingOwner>
        <reportingOwnerId><rptOwnerName>Alice Smith</rptOwnerName></reportingOwnerId>
        <reportingOwnerRelationship>
          <isOfficer>1</isOfficer>
          <officerTitle>Chief Executive Officer</officerTitle>
        </reportingOwnerRelationship>
      </reportingOwner>
      <nonDerivativeTable>
        <nonDerivativeTransaction>
          <transactionDate><value>2026-09-01</value></transactionDate>
          <transactionCoding><transactionCode>P</transactionCode></transactionCoding>
          <transactionAmounts>
            <transactionShares><value>1000</value></transactionShares>
            <transactionPricePerShare><value>10</value></transactionPricePerShare>
            <transactionAcquiredDisposedCode><value>A</value></transactionAcquiredDisposedCode>
          </transactionAmounts>
        </nonDerivativeTransaction>
      </nonDerivativeTable>
    </ownershipDocument>
    """
    rows = parse_form4_xml(xml, filing_date="2026-09-02", link="https://sec.gov/x")
    assert len(rows) == 1
    assert rows[0]["transactionCode"] == "P"
    assert rows[0]["securitiesTransacted"] == 1000
    assert rows[0]["reportingName"] == "Alice Smith"
    insider = compute_insider_net_buy_30d(rows, today=date(2026, 9, 6))
    assert insider["insider_net_buy_30d"] == 10000
    assert insider["lead_role"] == "CEO"
