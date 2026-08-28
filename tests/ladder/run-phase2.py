#!/usr/bin/env python3
"""Phase 2 hybrid judging — 4 cells: {n12, n06thin} x {critic_a, critic_b}.

Same rules as run-phase1.py (direct streaming, blinding derived from packet bytes,
one verdict per file the moment it lands, retry once on mid-stream death, cost from
usage fields, $3 floor). Differences, and only these:
  - arms are {A, B, D, H} — C is dropped, H is the hybrid under test;
  - packets live in packets2/, verdicts in verdicts2/.
"""
import json, os, re, sys, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
PACKETS, DOCS = os.path.join(ROOT, "packets2"), os.path.join(ROOT, "documents")
OUT = os.path.join(ROOT, "verdicts2")
KEY = os.environ.get("OPENROUTER_API_KEY", "")
API = "https://openrouter.ai/api/v1"
FLOOR = 3.00

CRITICS = {"critic_a": "openai/gpt-5.6-sol", "critic_b": "x-ai/grok-4.6"}
RUNGS = ["n12", "n06thin"]
ARMS = "ABDH"


def die(msg, code=1):
    print(f"\nSTOP: {msg}", file=sys.stderr); sys.exit(code)


def balance():
    req = urllib.request.Request(f"{API}/credits", headers={"Authorization": f"Bearer {KEY}"})
    d = json.load(urllib.request.urlopen(req, timeout=30))["data"]
    return d["total_credits"] - d["total_usage"]


def norm(s):
    return re.sub(r"\W+", " ", s).strip().lower()


def derive_blinding(packet_text, rung):
    hay, pos = norm(packet_text), {}
    for arm in ARMS:
        p = os.path.join(DOCS, f"out-{rung}-{arm}.md")
        if not os.path.exists(p):
            die(f"{rung}: missing document for arm {arm}")
        body = norm(open(p, encoding="utf8", errors="replace").read())
        hits = []
        for frac in (0.10, 0.45, 0.80):
            probe = body[int(len(body) * frac): int(len(body) * frac) + 160]
            if probe:
                i = hay.find(probe)
                if i >= 0:
                    hits.append(i)
        if not hits:
            die(f"{rung}: document {arm} does not appear in its own packet. Blinding unverifiable.")
        if max(hits) - min(hits) > len(body):
            die(f"{rung}: probes for {arm} landed in unrelated places. Packet may be malformed.")
        pos[arm] = min(hits)
    order = [a for a, _ in sorted(pos.items(), key=lambda kv: kv[1])]
    if len(order) != 4:
        die(f"{rung}: found {len(order)} of 4 documents in the packet.")
    return {f"Doc {i+1}": arm for i, arm in enumerate(order)}


def stream_call(model, message, max_tokens=8000):
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": message}],
        "max_tokens": max_tokens,
        "reasoning": {"effort": "low"},
        "stream": True,
        "usage": {"include": True},
    }).encode()
    req = urllib.request.Request(f"{API}/chat/completions", data=body, headers={
        "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
    })
    text, gen_id, usage = [], None, None
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            for raw in r:
                line = raw.decode("utf8", "replace").strip()
                if not line.startswith("data: "):
                    continue
                payload = line[6:]
                if payload == "[DONE]":
                    break
                try:
                    chunk = json.loads(payload)
                except json.JSONDecodeError:
                    continue
                if gen_id is None and chunk.get("id"):
                    gen_id = chunk["id"]
                if chunk.get("usage"):
                    usage = chunk["usage"]
                for ch in chunk.get("choices", []):
                    piece = (ch.get("delta") or {}).get("content")
                    if piece:
                        text.append(piece)
        return "".join(text), gen_id, usage, False
    except Exception as e:
        print(f"      stream died: {type(e).__name__}: {e}")
        return "".join(text), gen_id, usage, True


def main():
    if not KEY:
        die("OPENROUTER_API_KEY is not set")
    os.makedirs(OUT, exist_ok=True)
    start = balance()
    print(f"balance before: ${start:.4f}   floor ${FLOOR:.2f}\n")
    if start < FLOOR:
        die(f"balance ${start:.2f} is at or below the floor")

    spend, results = 0.0, []
    for rung in RUNGS:
        for critic, model in CRITICS.items():
            dest = os.path.join(OUT, f"critic-{rung}-{critic}.md")
            if os.path.exists(dest):
                print(f"{rung}/{critic}: already have a verdict, skipping"); continue
            packet_path = os.path.join(PACKETS, f"prompt-{rung}-{critic}.txt")
            if not os.path.exists(packet_path):
                print(f"{rung}/{critic}: NO PACKET — recorded MISSING")
                results.append((rung, critic, "MISSING", None, "no packet"))
                continue

            packet = open(packet_path, encoding="utf8", errors="replace").read()
            blind = derive_blinding(packet, rung)
            print(f"{rung}/{critic} [{model}]")
            print(f"      blinding derived from bytes: {blind}")

            text, gid, usage, died = stream_call(model, packet)
            if died:
                print(f"      died ({len(text)} chars kept), id={gid}. Retrying once.")
                text2, gid2, usage2, died2 = stream_call(model, packet)
                if died2:
                    open(dest + ".partial", "w", encoding="utf8").write(text or text2)
                    print("      second death — MISSING")
                    results.append((rung, critic, "MISSING", None, f"died twice, ids {gid} {gid2}"))
                    spend += ((usage or {}).get("cost") or 0) + ((usage2 or {}).get("cost") or 0)
                    continue
                text, gid, usage = text2, gid2, usage2

            c = (usage or {}).get("cost")
            spend += c or 0
            header = (f"<!-- generation_id: {gid} -->\n"
                      f"<!-- model: {model} -->\n"
                      f"<!-- cost_usd: {c} -->\n"
                      f"<!-- blinding DERIVED from packet bytes: {json.dumps(blind)} -->\n\n")
            open(dest, "w", encoding="utf8").write(header + text)
            print(f"      VERDICT written  id={gid}  cost=${c}  {len(text)} chars")
            results.append((rung, critic, "VERDICT", c, gid))

            bal = balance()
            if bal < FLOOR:
                die(f"balance ${bal:.2f} hit the floor after {rung}/{critic}.")

    end = balance()
    print(f"\n{'rung':10s} {'critic':10s} {'result':8s} {'cost':>9s}  id")
    for r, c, st, cost, gid in results:
        print(f"{r:10s} {c:10s} {st:8s} {('$%.4f' % cost) if cost else '        -':>9s}  {gid}")
    print(f"\nsum of usage-field costs: ${spend:.4f}")
    print(f"balance before ${start:.4f} -> after ${end:.4f}")


if __name__ == "__main__":
    main()
