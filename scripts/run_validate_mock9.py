#!/usr/bin/env python3
"""Adapter: map deploy-bank question -> validate.py's native schema, then run validate.py probe.
We only backfill the fields validate.py needs that we can derive deterministically:
  language=en, exam from source_reference.exam (or 'TMUA'), paper from q['paper'],
  section=sec1, track from topic, topic_codes from source_reference.original_topic_codes
  mapped to M/MM codes (best-effort), reasoning_steps/concepts_required/position
  estimated from adaptation_report/stem length as a sanity hint (advisory only).
"""
import json, sys, subprocess, os

MAP_TOPIC = {
    "Numbers and Sets": "M2",
    "Algebra and Functions": "M3",
    "Sequences and Series": "M3",
    "Graphs": "M4",
    "Coordinate Geometry": "M4",
    "Differentiation": "M5",
    "Integration": "M5",
    "Trigonometry": "MM4",
    "Exponentials and Logarithms": "M5",
    "Quadratics": "M3",
    "Vectors": "MM3",
    "Logarithms": "M5",
}

def to_validate(q):
    sr = q.get("source_reference") or {}
    # target exam is always TMUA (these are TMUA P1 questions adapted from MAT/TMUA sources)
    exam = "TMUA"
    paper = q.get("paper") or "P1"
    # topic_codes from original_topic_codes
    tcs = []
    for t in (sr.get("original_topic_codes") or []):
        c = MAP_TOPIC.get(t)
        if c and c not in tcs:
            tcs.append(c)
    if not tcs:
        tcs = ["M3"]
    # position heuristic from adaptation_report / difficulty
    d = q.get("difficulty") or 4
    pos = "late" if d >= 4 else ("mid" if d >= 2 else "early")
    ar = q.get("adaptation_report") or {}
    tq = str(ar.get("technique_added", ""))
    summary = str(ar.get("summary", ""))
    v = {
        "language": "en",
        "exam": exam,
        "paper": paper,
        "section": "sec1",
        "track": "computational",
        "topic_codes": tcs,
        "difficulty": d,
        "position": pos,
        "option_count": len(q.get("options") or []),
        "reasoning_steps": max(1, (q.get("difficulty") or 1) + 1),
        "concepts_required": max(1, len(tcs)),
        "stem": q.get("stem", ""),
        "options": q.get("options") or [],
        "answer": q.get("answer", ""),
        "solution": q.get("solution", ""),
        "distractors_rationale": q.get("distractors_rationale") or {},
        "calculator_free": True,
        "source_reference": sr,
        "adaptation_report": {
            "summary": summary,
            "technique_added": tq,
            "difficulty_shift": str(ar.get("difficulty_shift", "")) or summary,
            "knowledge_points_added": ar.get("knowledge_points_added") or ["M3"],
            "stem_diff": ar.get("stem_diff", []),
        },
        "scope_check": q.get("scope_check") or {},
    }
    return v

def main():
    bank = json.load(open(sys.argv[1]))
    qs = bank.get("questions") or bank
    vpy = "/Users/levi/.workbuddy/skills/esat-tmua-question-generator/scripts/validate.py"
    fails = warns = 0
    for i, q in enumerate(qs, 1):
        v = to_validate(q)
        tmp = f"/tmp/vq_{i}.json"
        json.dump(v, open(tmp, "w"))
        r = subprocess.run([sys.executable, vpy, tmp], capture_output=True, text=True)
        out = r.stdout.strip()
        # count levels
        nf = out.count("FAIL")
        nw = out.count("WARN")
        fails += nf
        warns += nw
        status = "OK" if (nf == 0 and nw == 0) else ("WARN" if nf == 0 else "FAIL")
        print(f"Q{i:2d} [{status}] FAIL={nf} WARN={nw}")
        if nf or nw:
            # print only the issue lines
            for line in out.splitlines():
                if "FAIL" in line or "WARN" in line:
                    print("      ", line[:160])
    print(f"\nTOTAL: FAIL={fails} WARN={warns} over {len(qs)} questions")

if __name__ == "__main__":
    main()
