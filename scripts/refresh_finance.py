"""Holiday ops CLI (READ-ONLY Omni). Examples:
  python scripts/refresh_finance.py recharges --start 20261001 --end 20261104
  python scripts/refresh_finance.py snapshot
  python scripts/refresh_finance.py costs --start 2026-10-29 --end 2026-11-04
  python scripts/refresh_finance.py all            # recharges last 7d + snapshot + costs last 2d
Then POST /api/v1/admin/reload (or restart uvicorn) so the API picks up files."""
import argparse, datetime as dt, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from sources import refresh as R

ap = argparse.ArgumentParser(); ap.add_argument("kind", choices=["recharges", "snapshot", "costs", "all"])
ap.add_argument("--start"); ap.add_argument("--end"); a = ap.parse_args()
iso = lambda s: f"{s[:4]}-{s[4:6]}-{s[6:]}" if s and "-" not in s else s
t = dt.date.fromisoformat(R.today())
if a.kind == "recharges": r = R.refresh_recharges(iso(a.start), iso(a.end or R.today()))
elif a.kind == "snapshot": r = R.refresh_snapshot()
elif a.kind == "costs": r = R.refresh_costs(iso(a.start), iso(a.end or R.today()))
else:
    c = R.client()
    r = {"recharges": R.refresh_recharges((t - dt.timedelta(days=6)).isoformat(), t.isoformat(), c=c),
         "snapshot": R.refresh_snapshot(c=c),
         "costs": R.refresh_costs((t - dt.timedelta(days=1)).isoformat(), t.isoformat(), c=c)}
print(json.dumps(r, ensure_ascii=False, indent=1))
