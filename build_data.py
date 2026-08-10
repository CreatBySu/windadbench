"""Generate website/data.js from the WindADBench-DA knowledge base.

Run from repo root:  python website/build_data.py
Exports the FULL metric matrix (25 detection/operational metrics + cost
columns) so the site can rank any model x workload x metric combination,
plus workload diagnostics for the new-model / new-dataset analysis views.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
AGENT = ROOT / "VLDB-Template" / "analysis" / "agent"
sys.path.insert(0, str(AGENT))

from agent_core import KB, _disc, failure_flags  # noqa: E402

METRIC_COLS = [
    "acc", "point_precision", "point_recall", "point_f1",
    "event_precision", "event_recall", "event_f1", "event_affiliation_f1",
    "range_precision", "range_recall", "range_f1",
    "affiliation_precision", "affiliation_recall", "affiliation_f1",
    "auc_pr", "auc_roc", "range_auc_pr", "range_auc_roc", "vus_pr", "vus_roc",
    "mean_lead_time", "mean_detection_delay", "early_detection_rate",
    "false_alarms_per_turbine_day", "mtbfa",
    "fit_time", "infer_time", "infer_gpu_mem", "model_size",
]

FARM_META = {
    "A": {"turbines": 5, "features": 86, "type": "onshore", "anomaly_events": 11},
    "B": {"turbines": 9, "features": 257, "type": "offshore", "anomaly_events": 6},
    "C": {"turbines": 22, "features": 957, "type": "offshore", "anomaly_events": 27},
}

DIAG_ORDER = ["CT-B", "CF-A>C", "IF-A", "CT-A", "CT-C", "CF-B>C",
              "CF-A>B", "IF-B", "IF-C", "CF-B>A", "CF-C>B", "CF-C>A"]


def r4(x) -> float | None:
    return None if pd.isna(x) else round(float(x), 4)


def main() -> None:
    kb = KB.load()
    models = sorted(kb.dim_pct["model"].unique())

    registry = [{
        "id": r["model"], "family": r["family"],
        "needs_gpu": bool(r["needs_gpu"]),
        "model_size": r4(r["model_size"]), "infer_time": r4(r["infer_time"]),
        "fit_time": r4(r["fit_time"]),
        "flags": failure_flags(kb, r["model"]),
    } for _, r in kb.registry.iterrows()]

    disc_raw = {w: _disc(kb, w, models) for w in kb.meta["workload"]}
    lo, hi = min(disc_raw.values()), max(disc_raw.values())
    workloads = []
    for _, r in kb.meta.iterrows():
        w = r["workload"]
        workloads.append({
            "workload": w, "track": r["track"], "source": r["source"],
            "target": r["target"], "n_events": int(r["n_events"]),
            "cost_proxy": r4(r["cost_proxy"]),
            "disc": r4((disc_raw[w] - lo) / (hi - lo + 1e-12)),
            "order_pos": DIAG_ORDER.index(w) + 1,
        })

    dims = [{"m": r["model"], "w": r["workload"],
             "a": r4(r["accuracy"]), "e": r4(r["earliness"]),
             "r": r4(r["reliability"]), "c": r4(r["cost"])}
            for r in kb.dim_pct.to_dict("records")]

    metrics = [{"m": r["model"], "w": r["workload"],
                **{c: r4(r[c]) for c in METRIC_COLS}}
               for r in kb.wide.to_dict("records")]

    cards = {}
    for m in models:
        g = kb.dim_pct[kb.dim_pct["model"] == m]
        cards[m] = {
            "accuracy": r4(g["accuracy"].mean()),
            "earliness": r4(g["earliness"].mean()),
            "reliability": r4(g["reliability"].mean()),
            "generalization": r4(
                g[g["track"].isin(["cross-turbine", "cross-farm"])]["accuracy"].mean()),
            "cost": r4(g["cost"].mean()),
        }

    results = AGENT / "results"
    summary = json.loads((results / "summary.json").read_text())
    data = {
        "registry": registry, "workloads": workloads, "dims": dims,
        "metrics": metrics, "cards": cards, "farms": FARM_META,
        "modeB": {"curve": pd.read_csv(results / "modeB_curve.csv").round(4).to_dict("records"),
                  "random": pd.read_csv(results / "modeB_random.csv").round(4).to_dict("records"),
                  "order": DIAG_ORDER, "summary": summary["mode_b"]},
        "modeA": summary["mode_a"],
    }
    out = ROOT / "website" / "data.js"
    out.write_text("window.WINDAD = " + json.dumps(data) + ";", encoding="utf-8")
    print(f"wrote {out} ({out.stat().st_size/1024:.0f} KB)")


if __name__ == "__main__":
    main()
