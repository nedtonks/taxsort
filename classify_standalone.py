"""
TaxSort – Standalone CLI classifier
Usage: python classify_standalone.py <bank_statement.csv>
Requires: pip install google-generativeai pandas
Set GEMINI_API_KEY environment variable before running.
"""

import csv
import json
import os
import sys
import textwrap

try:
    import google.generativeai as genai
except ImportError:
    sys.exit("Missing dependency. Run: pip install google-generativeai")

# ── ATO Category definitions ───────────────────────────────────────────────────

CATEGORIES = [
    ("cost_of_sales",         "Cost of Sales",                    "yes"),
    ("contractor_expenses",   "Contractor & Commission Expenses",  "yes"),
    ("superannuation",        "Superannuation Expenses",           "yes"),
    ("lease_expenses",        "Lease Expenses",                    "yes"),
    ("rent_expenses",         "Rent Expenses",                     "yes"),
    ("interest_expenses",     "Interest Expenses",                 "yes"),
    ("depreciation",          "Depreciation Expenses",             "yes"),
    ("motor_vehicle",         "Motor Vehicle Expenses",            "yes"),
    ("repairs_maintenance",   "Repairs & Maintenance",             "yes"),
    ("bad_debts",             "Bad Debts",                         "yes"),
    ("advertising_marketing", "Advertising & Marketing",           "yes"),
    ("bank_charges",          "Bank Charges & Fees",               "yes"),
    ("home_office",           "Home Office Expenses",              "yes"),
    ("insurance",             "Insurance",                         "yes"),
    ("phone_internet",        "Phone & Internet",                  "yes"),
    ("professional_fees",     "Professional Fees",                 "yes"),
    ("stationery_supplies",   "Stationery & Office Supplies",      "yes"),
    ("software_subscriptions","Software & Subscriptions",          "yes"),
    ("travel_accommodation",  "Travel & Accommodation",            "yes"),
    ("training_education",    "Training & Self-Education",         "yes"),
    ("uniforms_clothing",     "Uniforms & Protective Clothing",    "yes"),
    ("tools_equipment",       "Tools & Equipment",                 "yes"),
    ("not_deductible",        "Not Deductible",                    "no"),
    ("needs_review",          "Needs Review",                      "review"),
]

VALID_KEYS = {c[0] for c in CATEGORIES}
CATEGORY_LABEL = {c[0]: c[1] for c in CATEGORIES}
CATEGORY_DEDUCTIBLE = {c[0]: c[2] for c in CATEGORIES}

SYSTEM_PROMPT = textwrap.dedent("""
    You are an Australian tax specialist for sole traders. Classify each bank transaction
    into the correct ATO Business & Professional Items Schedule (P8) category.

    Use ONLY these exact category keys:
    - cost_of_sales: Stock/goods purchased for resale or production
    - contractor_expenses: Subcontractors, freelancers, commissions paid
    - superannuation: Super contributions for employees or self
    - lease_expenses: Equipment/vehicle leases (not real estate)
    - rent_expenses: Office, workshop, commercial premises rent
    - interest_expenses: Business loan interest, credit facility interest
    - depreciation: Asset depreciation, instant asset write-off purchases
    - motor_vehicle: Fuel (Caltex/BP/Shell/Ampol), rego, servicing, vehicle insurance
    - repairs_maintenance: Repairs to equipment, tools, business premises
    - bad_debts: Written-off irrecoverable client debts
    - advertising_marketing: Google Ads, Facebook Ads, printing, signage, marketing agency
    - bank_charges: Monthly account fee, EFTPOS/Stripe/Square fees, merchant fees
    - home_office: Business portion of home internet, electricity (home office)
    - insurance: Professional indemnity, public liability, business insurance premiums
    - phone_internet: Telstra, Optus, Vodafone, TPG phone/internet bills
    - professional_fees: Accountant, bookkeeper, solicitor, BAS agent fees
    - stationery_supplies: Officeworks, paper, ink, postage, Australia Post
    - software_subscriptions: Xero, MYOB, Adobe, AWS, Microsoft 365, Canva, Slack
    - travel_accommodation: Qantas, Virgin, hotels, taxis on business trips
    - training_education: Courses, conferences, professional development
    - uniforms_clothing: Safety boots, hi-vis, PPE, branded work uniforms
    - tools_equipment: Hand tools, trade tools, small business equipment
    - not_deductible: Personal expenses, entertainment, ATO tax payments, income credits
    - needs_review: Woolworths, Coles, Uber, Amazon, cash, ambiguous merchants

    Rules:
    - Positive amounts (income) → not_deductible (note: income, not an expense)
    - ATO/tax office payments → not_deductible
    - Grocery stores → needs_review unless description clearly says 'office supplies'
    - Confidence: high = obvious match, medium = likely, low = uncertain

    Return ONLY a raw JSON array. No markdown, no explanation.
    Format: [{"id":"...","category":"...","confidence":"high|medium|low","notes":"..."}]
""").strip()

# ── CSV parsing ────────────────────────────────────────────────────────────────

def normalise(s: str) -> str:
    return s.strip().lower().replace(" ", "").replace("_", "").replace("-", "")

def find_col(headers: list[str], candidates: list[str]) -> str | None:
    norm = [normalise(h) for h in headers]
    for c in candidates:
        if c in norm:
            return headers[norm.index(c)]
    return None

def parse_amount(raw: str) -> float:
    cleaned = raw.strip().replace("$", "").replace(",", "")
    try:
        return float(cleaned)
    except ValueError:
        return 0.0

def load_csv(path: str) -> list[dict]:
    with open(path, newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        rows = [r for r in reader if any(v.strip() for v in r.values())]

    if not rows:
        sys.exit("CSV is empty or could not be parsed.")

    headers = list(rows[0].keys())
    date_col = find_col(headers, ["date", "transactiondate", "valuedate"])
    desc_col = find_col(headers, ["description", "particulars", "narrative", "details", "memo"])

    if not date_col or not desc_col:
        sys.exit("Could not find Date or Description columns.")

    norm_headers = [normalise(h) for h in headers]
    is_westpac = "debit" in norm_headers and "credit" in norm_headers

    transactions = []
    for i, row in enumerate(rows):
        date = row.get(date_col, "").strip()
        desc = row.get(desc_col, "").strip()
        if not date or not desc:
            continue

        if is_westpac:
            debit_col = find_col(headers, ["debit", "withdrawal"])
            credit_col = find_col(headers, ["credit", "deposit"])
            debit = parse_amount(row.get(debit_col, "") or "0")
            credit = parse_amount(row.get(credit_col, "") or "0")
            amount = credit if credit > 0 else -abs(debit)
        else:
            amount_col = find_col(headers, ["amount", "transactionamount", "value"])
            amount = parse_amount(row.get(amount_col, "0")) if amount_col else 0.0

        transactions.append({"id": str(i + 1), "date": date, "description": desc, "amount": amount})

    return transactions

# ── Gemini classification ──────────────────────────────────────────────────────

BATCH_SIZE = 25

def chunk(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]

def classify_batch(model, batch: list[dict]) -> list[dict]:
    prompt = f"Classify these transactions:\n{json.dumps(batch)}"
    response = model.generate_content(prompt)
    text = response.text.strip().lstrip("```json").lstrip("```").rstrip("```").strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        import re
        match = re.search(r"\[.*\]", text, re.DOTALL)
        if match:
            return json.loads(match.group())
        return []

def classify(transactions: list[dict], api_key: str) -> list[dict]:
    genai.configure(api_key=api_key)
    model = genai.GenerativeModel(
        model_name="gemini-2.5-flash",
        system_instruction=SYSTEM_PROMPT,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
        ),
    )

    results = []
    batches = list(chunk(transactions, BATCH_SIZE))
    for i, batch in enumerate(batches):
        print(f"  Classifying batch {i + 1}/{len(batches)} ({len(batch)} transactions)…")
        classified = classify_batch(model, batch)
        for item in classified:
            original = next((t for t in batch if t["id"] == item.get("id")), None)
            if not original:
                continue
            cat = item.get("category", "needs_review")
            if cat not in VALID_KEYS:
                cat = "needs_review"
            conf = item.get("confidence", "low")
            if conf not in ("high", "medium", "low"):
                conf = "low"
            results.append({**original, "category": cat, "confidence": conf, "notes": item.get("notes", "")})

    # Fallback for missed rows
    classified_ids = {r["id"] for r in results}
    for t in transactions:
        if t["id"] not in classified_ids:
            results.append({**t, "category": "needs_review", "confidence": "low", "notes": "Could not classify – review manually"})

    return sorted(results, key=lambda r: int(r["id"]))

# ── Output ─────────────────────────────────────────────────────────────────────

def write_output(results: list[dict], input_path: str):
    out_path = input_path.replace(".csv", "_taxsort.csv")
    fieldnames = ["date", "description", "amount", "category", "category_label", "deductible", "confidence", "notes"]
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            writer.writerow({
                "date": r["date"],
                "description": r["description"],
                "amount": r["amount"],
                "category": r["category"],
                "category_label": CATEGORY_LABEL.get(r["category"], r["category"]),
                "deductible": CATEGORY_DEDUCTIBLE.get(r["category"], "review"),
                "confidence": r["confidence"],
                "notes": r["notes"],
            })
    return out_path

def print_summary(results: list[dict]):
    deductible = [r for r in results if CATEGORY_DEDUCTIBLE.get(r["category"]) == "yes" and r["amount"] < 0]
    not_ded = [r for r in results if CATEGORY_DEDUCTIBLE.get(r["category"]) == "no"]
    review = [r for r in results if CATEGORY_DEDUCTIBLE.get(r["category"]) == "review"]

    total_ded = sum(abs(r["amount"]) for r in deductible)

    print("\n" + "=" * 50)
    print("  TaxSort – Classification Summary")
    print("=" * 50)
    print(f"  Total transactions : {len(results)}")
    print(f"  Deductible         : {len(deductible)} transactions  (${total_ded:,.2f})")
    print(f"  Not deductible     : {len(not_ded)} transactions")
    print(f"  Needs review       : {len(review)} transactions")
    print()

    from collections import Counter
    counts = Counter(r["category"] for r in deductible)
    print("  Deductible breakdown:")
    for cat, count in counts.most_common():
        label = CATEGORY_LABEL.get(cat, cat)
        total = sum(abs(r["amount"]) for r in deductible if r["category"] == cat)
        print(f"    {label:<40} {count:>3} tx   ${total:>10,.2f}")
    print("=" * 50)

# ── Entry point ────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print("Usage: python classify_standalone.py <bank_statement.csv>")
        sys.exit(1)

    csv_path = sys.argv[1]
    if not os.path.exists(csv_path):
        sys.exit(f"File not found: {csv_path}")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("Set GEMINI_API_KEY environment variable before running.")

    print(f"Loading {csv_path}…")
    transactions = load_csv(csv_path)
    print(f"Found {len(transactions)} transactions. Classifying…")

    results = classify(transactions, api_key)
    out_path = write_output(results, csv_path)
    print_summary(results)
    print(f"\n  Output saved to: {out_path}\n")

if __name__ == "__main__":
    main()
