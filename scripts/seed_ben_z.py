"""Seed the Ben Z workspace with realistic test data.

Idempotent: wipes income_entries + transactions, then rewrites planned
amounts and re-seeds actuals through the current date (2026-04-19).
The schema (years, months, buckets, lines) is left untouched.

Run from anywhere:

    python3 scripts/seed_ben_z.py

The seed is deterministic (random.seed(42)) so re-runs produce the
same data. Designed for use with the running mimo dev build to give
the UI something interesting to render across multiple years.
"""

from __future__ import annotations

import datetime as dt
import random
import sqlite3
from pathlib import Path

DB_PATH = Path.home() / "Documents" / "Budget" / "Ben Z.mimo"
TODAY = dt.date(2026, 4, 19)
SEED = 42

# Bi-weekly pay schedule. Anchored on a Friday in early Jan 2025.
PAYCHECK_ANCHOR = dt.date(2025, 1, 10)
PAYCHECK_NET_CENTS = 240000  # $2,400 net per check (varies +/- a bit)

# Planned amounts (cents).
INCOME_PLANNED = {
    "Wages": 520000,                # 26 paychecks * $2,400 / 12 ≈ $5,200
    "Interest & dividends": 2000,   # $20
    "Other income": 0,              # ad hoc, not budgeted
}

EXPENSE_PLANNED = {
    "Rent / mortgage": 180000,
    "Utilities": 18000,
    "Maintenance": 5000,
    "Fuel": 18000,
    "Insurance": 13500,
    "Maintenance / repairs": 4000,
    "Premiums": 22000,
    "Out of pocket": 6000,
    "Donations": 8000,
    "Streaming & apps": 5500,
    "Groceries": 55000,
    "Household supplies": 8000,
    "Dining out & fun": 25000,
    "Emergency fund": 40000,
    "Student / other loans": 28000,
    "Taxes": 0,
    "Credit card payment (tracking)": 120000,
    "Gifts & travel": 15000,
    "Annual subscriptions & renewals": 4000,
    "Other": 4000,
}

# A handful of "Other income" sales scattered across each year.
SALES_2025 = [
    (dt.date(2025, 3, 8), "Marketplace — bookshelf", 12500),
    (dt.date(2025, 6, 21), "Garage sale haul", 28000),
    (dt.date(2025, 9, 14), "eBay — old camera lens", 18500),
    (dt.date(2025, 11, 2), "Craft fair booth", 9500),
]
SALES_2026 = [
    (dt.date(2026, 2, 13), "Marketplace — desk", 15000),
    (dt.date(2026, 4, 5), "Old guitar pedal", 22000),
    # The third 2026 sale lands after "today"; the inserter filters it out
    # so the future month stays planned-only.
    (dt.date(2026, 8, 23), "Yard sale", 11000),
]


def seed():
    rand = random.Random(SEED)
    con = sqlite3.connect(str(DB_PATH))
    con.execute("PRAGMA foreign_keys = ON")
    cur = con.cursor()

    # Clean slate for repeatable seeds.
    cur.execute("DELETE FROM income_entries")
    cur.execute("DELETE FROM transactions")

    # Push planned amounts to every line by name.
    for name, cents in INCOME_PLANNED.items():
        cur.execute(
            "UPDATE income_lines SET planned_cents = ? WHERE name = ?",
            (cents, name),
        )
    for name, cents in EXPENSE_PLANNED.items():
        cur.execute(
            "UPDATE expense_lines SET planned_cents = ? WHERE name = ?",
            (cents, name),
        )

    months = cur.execute(
        "SELECT id, period_start, period_end FROM budget_months ORDER BY period_start"
    ).fetchall()

    income_lookup = {}
    expense_lookup = {}
    for mid, _, _ in months:
        income_lookup[mid] = {
            n: i
            for n, i in cur.execute(
                "SELECT name, id FROM income_lines WHERE month_id = ?",
                (mid,),
            ).fetchall()
        }
        expense_lookup[mid] = {
            n: i
            for n, i in cur.execute(
                """
                SELECT l.name, l.id FROM expense_lines l
                JOIN expense_buckets b ON l.bucket_id = b.id
                WHERE b.month_id = ?
                """,
                (mid,),
            ).fetchall()
        }

    sales_by_year = {2025: SALES_2025, 2026: SALES_2026}

    for mid, ps, pe in months:
        start = dt.date.fromisoformat(ps)
        end = dt.date.fromisoformat(pe)
        # Cap actuals at "today" so future months stay planned-only.
        actuals_end = min(end, TODAY)
        if actuals_end < start:
            continue  # entire month is in the future
        year = start.year

        seed_income(cur, mid, start, actuals_end, income_lookup[mid],
                    sales_by_year.get(year, []), rand)
        seed_expenses(cur, mid, start, actuals_end, expense_lookup[mid], rand)

    con.commit()
    con.close()


def seed_income(cur, mid, start, end, lines, year_sales, rand):
    wages_id = lines.get("Wages")
    div_id = lines.get("Interest & dividends")
    other_id = lines.get("Other income")

    if wages_id is not None:
        d = PAYCHECK_ANCHOR
        while d < start:
            d += dt.timedelta(days=14)
        while d <= end:
            jitter = rand.randint(-2000, 2000)  # +/- $20
            cur.execute(
                """
                INSERT INTO income_entries
                    (income_line_id, received_on, label, amount_cents, sort_order)
                VALUES (?, ?, ?, ?, 0)
                """,
                (wages_id, d.isoformat(), "Paycheck", PAYCHECK_NET_CENTS + jitter),
            )
            d += dt.timedelta(days=14)

    # Interest/dividends posts on a fixed-ish day each month, but ~3 months
    # per year are skipped to leave "no data" gaps for testing.
    if div_id is not None and rand.random() > 0.25:
        day = min(rand.randint(20, 28), end.day)
        amount = rand.randint(500, 4000)
        post = dt.date(start.year, start.month, day)
        if post <= end:
            cur.execute(
                """
                INSERT INTO income_entries
                    (income_line_id, received_on, label, amount_cents, sort_order)
                VALUES (?, ?, ?, ?, 0)
                """,
                (div_id, post.isoformat(), "Brokerage dividend", amount),
            )

    if other_id is not None:
        for sale_date, label, cents in year_sales:
            if start <= sale_date <= end:
                cur.execute(
                    """
                    INSERT INTO income_entries
                        (income_line_id, received_on, label, amount_cents, sort_order)
                    VALUES (?, ?, ?, ?, 0)
                    """,
                    (other_id, sale_date.isoformat(), label, cents),
                )


def seed_expenses(cur, mid, start, end, lines, rand):
    insert = lambda line_id, d, payee, cents: cur.execute(
        """
        INSERT INTO transactions
            (expense_line_id, occurred_on, payee, amount_cents, sort_order)
        VALUES (?, ?, ?, ?, 0)
        """,
        (line_id, d.isoformat() if d else None, payee, cents),
    )

    def date_in(day):
        """Clamp a desired day-of-month into the seed window."""
        capped = min(day, end.day)
        if capped < start.day:
            return None
        return dt.date(start.year, start.month, capped)

    # ------- Recurring monthlies -------
    if "Rent / mortgage" in lines and (d := date_in(1)):
        insert(lines["Rent / mortgage"], d, "Landlord ACH", 180000)
    if "Premiums" in lines and (d := date_in(1)):
        insert(lines["Premiums"], d, "Health insurance", 22000)
    if "Insurance" in lines and (d := date_in(15)):
        insert(lines["Insurance"], d, "Auto insurance", 13500)
    if "Emergency fund" in lines and (d := date_in(5)):
        insert(lines["Emergency fund"], d, "Savings transfer", 40000)
    if "Student / other loans" in lines and (d := date_in(25)):
        insert(lines["Student / other loans"], d, "Loan servicer", 28000)

    # ------- Utilities (1-2 bills) -------
    if "Utilities" in lines:
        if (d := date_in(7)):
            insert(lines["Utilities"], d, "Electric co-op",
                   rand.randint(7500, 11500))
        if rand.random() > 0.15 and (d := date_in(14)):
            insert(lines["Utilities"], d, "Water / gas",
                   rand.randint(4500, 9000))

    # ------- Fuel: 3-4 fillups, skip every now and then -------
    if "Fuel" in lines:
        fillups = rand.randint(3, 4)
        # Skip ~1 month/yr to test blank lines
        if rand.random() < 0.07:
            fillups = 0
        for _ in range(fillups):
            day = rand.randint(1, 28)
            d = date_in(day)
            if d is None:
                continue
            insert(lines["Fuel"], d, rand.choice([
                "Shell", "Costco gas", "BP", "76", "Mobil",
            ]), rand.randint(3500, 6200))

    # ------- Maintenance / repairs (sporadic) -------
    if "Maintenance / repairs" in lines:
        # Quarterly oil change.
        if start.month in (1, 4, 7, 10) and (d := date_in(rand.randint(8, 22))):
            insert(lines["Maintenance / repairs"], d,
                   "Oil change", rand.randint(6500, 9500))
        # Random bigger repair every 8-10 months.
        if rand.random() < 0.12 and (d := date_in(rand.randint(5, 25))):
            insert(lines["Maintenance / repairs"], d,
                   "Brake pads / tires", rand.randint(18000, 55000))

    # ------- Home maintenance (mostly blank) -------
    if "Maintenance" in lines and rand.random() < 0.3:
        d = date_in(rand.randint(5, 25))
        if d:
            insert(lines["Maintenance"], d,
                   rand.choice(["HVAC filter", "Plumber", "Hardware store"]),
                   rand.randint(3500, 18000))

    # ------- Out of pocket health -------
    if "Out of pocket" in lines:
        for _ in range(rand.randint(0, 2)):
            d = date_in(rand.randint(2, 27))
            if d is None:
                continue
            insert(lines["Out of pocket"], d,
                   rand.choice(["Pharmacy copay", "Specialist visit", "Dental"]),
                   rand.randint(1500, 12000))

    # ------- Donations (every other month + Dec spike) -------
    if "Donations" in lines:
        if start.month % 2 == 0 and (d := date_in(rand.randint(8, 22))):
            insert(lines["Donations"], d, "Local food bank",
                   rand.randint(4000, 9500))
        if start.month == 12 and (d := date_in(20)):
            insert(lines["Donations"], d, "Year-end gift", 20000)

    # ------- Streaming bundle -------
    if "Streaming & apps" in lines:
        for day, vendor, cents in [
            (3, "Netflix", 1599),
            (7, "Spotify Family", 1699),
            (12, "iCloud+", 299),
            (19, "Adobe", 999),
        ]:
            if rand.random() < 0.92 and (d := date_in(day)):
                insert(lines["Streaming & apps"], d, vendor, cents)

    # ------- Groceries -------
    if "Groceries" in lines:
        trips = rand.randint(4, 6)
        for _ in range(trips):
            d = date_in(rand.randint(1, 28))
            if d is None:
                continue
            insert(lines["Groceries"], d, rand.choice([
                "Trader Joe's", "Costco", "Kroger", "Whole Foods", "Aldi",
            ]), rand.randint(6500, 17000))

    # ------- Household supplies -------
    if "Household supplies" in lines:
        for _ in range(rand.randint(1, 2)):
            d = date_in(rand.randint(1, 28))
            if d is None:
                continue
            insert(lines["Household supplies"], d, rand.choice([
                "Target", "Amazon", "Home Depot",
            ]), rand.randint(1500, 6500))

    # ------- Dining out & fun -------
    if "Dining out & fun" in lines:
        for _ in range(rand.randint(5, 8)):
            d = date_in(rand.randint(1, 28))
            if d is None:
                continue
            insert(lines["Dining out & fun"], d, rand.choice([
                "Local taco shop", "Coffee", "Brewery", "Date night",
                "Movies", "Concert", "Book + tea",
            ]), rand.randint(1200, 6500))

    # ------- Taxes (April only, occasional Q4 estimate) -------
    if "Taxes" in lines:
        if start.month == 4 and (d := date_in(15)):
            insert(lines["Taxes"], d, "Federal balance due",
                   rand.randint(60000, 145000))
        if start.month == 1 and rand.random() < 0.5 and (d := date_in(15)):
            insert(lines["Taxes"], d, "Q4 estimated tax", 30000)

    # ------- Credit card (tracking / neutral) -------
    if "Credit card payment (tracking)" in lines and (d := date_in(18)):
        insert(lines["Credit card payment (tracking)"], d,
               "Statement payment",
               rand.randint(85000, 158000))

    # ------- Gifts & travel (sinking) -------
    if "Gifts & travel" in lines:
        # Small monthly drift.
        if rand.random() > 0.4 and (d := date_in(rand.randint(3, 26))):
            insert(lines["Gifts & travel"], d, "Birthday gift",
                   rand.randint(2000, 7500))
        # Summer / winter spikes.
        if start.month in (6, 7) and (d := date_in(rand.randint(8, 24))):
            insert(lines["Gifts & travel"], d, "Summer trip",
                   rand.randint(45000, 95000))
        if start.month == 12 and (d := date_in(15)):
            insert(lines["Gifts & travel"], d, "Holiday gifts", 70000)

    # ------- Annual subscriptions / renewals (sinking) -------
    if "Annual subscriptions & renewals" in lines:
        if start.month == 1 and (d := date_in(11)):
            insert(lines["Annual subscriptions & renewals"], d,
                   "Amazon Prime", 13900)
            insert(lines["Annual subscriptions & renewals"], d,
                   "Domain renewals", 4500)
        if start.month == 7 and (d := date_in(20)):
            insert(lines["Annual subscriptions & renewals"], d,
                   "AAA membership", 7500)

    # ------- Misc (sporadic) -------
    if "Other" in lines and rand.random() < 0.4:
        d = date_in(rand.randint(5, 25))
        if d:
            insert(lines["Other"], d, rand.choice([
                "Parking", "Lost item replacement", "Postage",
            ]), rand.randint(800, 4500))


if __name__ == "__main__":
    if not DB_PATH.exists():
        raise SystemExit(f"Ben Z workspace not found at {DB_PATH}")
    seed()
    print(f"Seeded {DB_PATH}")
