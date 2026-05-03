# TaxSort — 30-Case Evaluation Guide
## File: evaluation_30.csv

Each row shows the expected classification for measuring system accuracy.
Confidence thresholds: High = obvious match, Medium = likely, Low = uncertain.

| # | Description | Expected Category | Expected Confidence | Deductible |
|---|-------------|-------------------|---------------------|------------|
| 1 | CALTEX CARINDALE | motor_vehicle | high | yes |
| 2 | TELSTRA BUSINESS MOBILE | phone_internet | high | yes |
| 3 | XERO ACCOUNTING | software_subscriptions | high | yes |
| 4 | GOOGLE ADS AUSTRALIA | advertising_marketing | high | yes |
| 5 | ANZ MONTHLY ACCOUNT FEE | bank_charges | high | yes |
| 6 | BP EIGHT MILE PLAINS | motor_vehicle | high | yes |
| 7 | ADOBE CREATIVE CLOUD | software_subscriptions | high | yes |
| 8 | OPTUS BUSINESS PLAN | phone_internet | high | yes |
| 9 | AWS AMAZON WEB SERVICES | software_subscriptions | high | yes |
| 10 | CANVA PRO SUBSCRIPTION | software_subscriptions | high | yes |
| 11 | BUNNINGS WAREHOUSE | repairs_maintenance | medium | yes |
| 12 | OFFICEWORKS ONLINE | stationery_supplies | medium | yes |
| 13 | TOTAL TOOLS ONLINE | tools_equipment | medium | yes |
| 14 | QANTAS AIRWAYS BNE-SYD | travel_accommodation | medium | yes |
| 15 | MARRIOTT SYDNEY CBD | travel_accommodation | medium | yes |
| 16 | WOOLWORTHS 3142 | needs_review | medium | review |
| 17 | UBER TRIP CITY | needs_review | medium | review |
| 18 | AMAZON AU MARKETPLACE | needs_review | medium | review |
| 19 | COLES SUPERMARKET 0491 | needs_review | medium | review |
| 20 | ATM CASH WITHDRAWAL | needs_review | low | review |
| 21 | MCDONALDS QUEEN ST | not_deductible | high | no |
| 22 | NETFLIX ENTERTAINMENT | not_deductible | high | no |
| 23 | ATO BAS PAYMENT | not_deductible | high | no |
| 24 | MEDICARE LEVY SURCHARGE | not_deductible | high | no |
| 25 | CLIENT PAYMENT - INV0055 | not_deductible | high | no |
| 26 | AUSTRALIANSUPER EMPLOYER CONTRIBUTION | superannuation | high | yes |
| 27 | OFFICE RENT MARCH 2025 | rent_expenses | high | yes |
| 28 | SUNCORP PROFESSIONAL INDEMNITY | insurance | high | yes |
| 29 | LINKEDIN LEARNING ANNUAL | training_education | high | yes |
| 30 | ACCOUNTING FEE - MARCH BAS | professional_fees | high | yes |

---

## Scoring

| Group | Cases | Expected accuracy |
|-------|-------|-------------------|
| Clear deductibles (1–15) | 15 | ≥ 93% |
| Needs review / ambiguous (16–20) | 5 | ≥ 80% flagged correctly |
| Non-deductible (21–25) | 5 | 100% |
| Other deductible categories (26–30) | 5 | ≥ 80% |
| **Total** | **30** | **≥ 90%** |

**Accuracy formula:** (correct category matches / 30) × 100

A match counts if the system returns the expected `category` key exactly.
For `needs_review` cases, a match also counts if the system returns `needs_review`
(i.e. correctly identifies ambiguity rather than guessing a wrong category).

---

## Edge Case Notes

- **#11 Bunnings** — acceptable as either `repairs_maintenance` or `tools_equipment`; both count as correct
- **#13 Total Tools** — acceptable as either `tools_equipment` or `repairs_maintenance`
- **#14–15 Travel** — only correct if Gemini does NOT assume personal travel; description context should guide medium confidence
- **#25 Client Payment** — positive amount, should be `not_deductible` with note about income
- **#20 ATM Cash** — most ambiguous; low confidence `needs_review` is the ideal response

---

## Other Test Files

| File | Purpose | Format |
|------|---------|--------|
| `sample_anz.csv` | General 30-transaction smoke test | ANZ (Date, Description, Amount, Balance) |
| `sample_westpac.csv` | Validates Westpac debit/credit column parsing | Westpac (Date, Description, Debit, Credit, Balance) |
| `test_edge_cases.csv` | 15 deliberately tricky transactions | ANZ format |
| `evaluation_30.csv` | Primary 30-case accuracy evaluation | ANZ format |
