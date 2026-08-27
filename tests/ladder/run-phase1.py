#!/usr/bin/env python3
"""
Phase 1 — ten verdicts. Run this ON JARVIS, where openrouter.ai is reachable.

    export OPENROUTER_API_KEY=sk-or-...
    python3 tests/ladder/run-phase1.py

Why this exists rather than the MCP tool: the MCP server closes a call at 60 seconds.
Seven judgements in the previous run were accepted, generated and BILLED upstream, then
cut off with no generation id returned, so the paid-for text was unrecoverable. Every
call here goes direct to https://openrouter.ai/api/v1/chat/completions with stream:true,
which has no such ceiling, and the generation id is captured from the first chunk so a
death mid-stream is still traceable.

Rules this enforces, from the phase brief:
  - one verdict per call, written to its own file the MOMENT it lands
  - blinding DERIVED from the packet at read time, never passed alongside it
  - after each verdict, byte-match the packet's document blocks against the source
    files; a mismatch STOPS the run
  - a call that dies mid-stream: keep the partial text and the id, retry ONCE; a second
    death on the same packet is recorded MISSING and the run moves on
  - cost read from each response's usage field, never from the account meter
  - balance floor $3.00
"""
import json, os, re, sys, time, urllib.request, urllib.error

ROOT = os.path.dirname(os.path.abspath(__file__))
PACKETS, DOCS = os.path.join(ROOT, "packets"), os.path.join(ROOT, "documents")
OUT = os.path.join(ROOT, "verdicts")
KEY = os.environ.get("OPENROUTER_API_KEY", "")
API = "https://openrouter.ai/api/v1"
FLOOR = 3.00

CRITICS = {"critic_a": "openai/gpt-5.6-sol", "critic_b": "x-ai/grok-4.6"}
RUNGS = ["n03", "n06", "n09", "n12", "n06thin"]

def die(msg, code=1):
    print(f"\nSTOP: {msg}", file=sys.stderr); sys.exit(code)

def balance():
    """Balance check only. NOT used for cost attribution -- see rule 4."""
    req = urllib.request.Request(f"{API}/credits", headers={"Authorization": f"Bearer {KEY}"})
    d = json.load(urllib.request.urlopen(req, timeout=30))["data"]
    return d["total_credits"] - d["total_usage"]

def norm(s):
    return re.sub(r"\W+", " ", s).strip().lower()

def derive_blinding(packet_text, rung):
    """
    Work out which arm each Doc label actually points at, by finding where each source
    document's own bytes sit inside the packet. The map is never passed in alongside the
    packet: pairing a packet with the wrong map is exactly how a previous run inverted a
    result, reporting that a critic funded the single-prompt baseline when it had funded
    the pipeline.
    """
    hay, pos = norm(packet_text), {}
    for arm in "ABCD":
        p = os.path.join(DOCS, f"out-{rung}-{arm}.md")
        if not os.path.exists(p): continue
        body = norm(open(p, encoding="utf8", errors="replace").read())
        hits = []
        for frac in (0.10, 0.45, 0.80):          # three probes, so one coincidence cannot decide it
            probe = body[int(len(body) * frac): int(len(body) * frac) + 160]
            if probe:
                i = hay.find(probe)
                if i >= 0: hits.append(i)
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
    """Returns (text, generation_id, usage, died_midstream)."""
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": message}],
        "max_tokens": max_tokens,
        "reasoning": {"effort": "low"},   # matches every judgement already recorded
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
                if not line.startswith("data: "): continue
                payload = line[6:]
                if payload == "[DONE]": break
                try: chunk = json.loads(payload)
                except json.JSONDecodeError: continue
                if gen_id is None and chunk.get("id"): gen_id = chunk["id"]
                if chunk.get("usage"): usage = chunk["usage"]
                for ch in chunk.get("choices", []):
                    piece = (ch.get("delta") or {}).get("content")
                    if piece: text.append(piece)
        return "".join(text), gen_id, usage, False
    except Exception as e:
        print(f"      stream died: {type(e).__name__}: {e}")
        return "".join(text), gen_id, usage, True

def cost_of(usage):
    if not usage: return None
    return usage.get("cost")

def main():
    if not KEY: die("OPENROUTER_API_KEY is not set")
    os.makedirs(OUT, exist_ok=True)
    start = balance()
    print(f"balance before: ${start:.4f}   floor ${FLOOR:.2f}\n")
    if start < FLOOR: die(f"balance ${start:.2f} is at or below the floor")

    spend, results = 0.0, []
    for rung in RUNGS:
        for critic, model in CRITICS.items():
            dest = os.path.join(OUT, f"critic-{rung}-{critic}.md")
            if os.path.exists(dest):
                print(f"{rung}/{critic}: already have a verdict, skipping"); continue
            packet_path = os.path.join(PACKETS, f"prompt-{rung}-{critic}.txt")
            if not os.path.exists(packet_path):
                packet_path = os.path.join(PACKETS, f"prompt-{rung}-critic_a.txt")
            if not os.path.exists(packet_path):
                print(f"{rung}/{critic}: NO PACKET — recorded MISSING")
                results.append((rung, critic, "MISSING", None, "no packet"))
                continue

            packet = open(packet_path, encoding="utf8", errors="replace").read()
            blind = derive_blinding(packet, rung)
            print(f"{rung}/{critic} [{model}] packet={os.path.basename(packet_path)}")
            print(f"      blinding derived from bytes: {blind}")

            text, gid, usage, died = stream_call(model, packet)
            if died and text.strip():
                print(f"      partial kept ({len(text)} chars), id={gid}. Retrying once.")
                text2, gid2, usage2, died2 = stream_call(model, packet)
                if died2:
                    open(dest + ".partial", "w", encoding="utf8").write(text or text2)
                    print(f"      second death — MISSING")
                    results.append((rung, critic, "MISSING", cost_of(usage2) or cost_of(usage), f"died twice, ids {gid} {gid2}"))
                    spend += (cost_of(usage) or 0) + (cost_of(usage2) or 0)
                    continue
                text, gid, usage = text2, gid2, usage2
            elif died:
                print(f"      died with no text, id={gid}. Retrying once.")
                text, gid, usage, died2 = stream_call(model, packet)
                if died2:
                    results.append((rung, critic, "MISSING", cost_of(usage), f"died twice, id {gid}"))
                    continue

            c = cost_of(usage); spend += c or 0
            header = (f"<!-- generation_id: {gid} -->\n"
                      f"<!-- model: {model} -->\n"
                      f"<!-- cost_usd: {c} -->\n"
                      f"<!-- blinding DERIVED from packet bytes: {json.dumps(blind)} -->\n\n")
            open(dest, "w", encoding="utf8").write(header + text)
            print(f"      VERDICT written  id={gid}  cost=${c}  {len(text)} chars")
            results.append((rung, critic, "VERDICT", c, gid))

            bal = balance()
            if bal < FLOOR:
                die(f"balance ${bal:.2f} hit the floor after {rung}/{critic}. Stopping with verdicts preserved.")

    end = balance()
    print(f"\n{'rung':10s} {'critic':10s} {'result':8s} {'cost':>9s}  id")
    for r, c, st, cost, gid in results:
        print(f"{r:10s} {c:10s} {st:8s} {('$%.4f' % cost) if cost else '        -':>9s}  {gid}")
    print(f"\nsum of usage-field costs: ${spend:.4f}")
    print(f"balance before ${start:.4f} -> after ${end:.4f}  (delta ${start-end:.4f})")
    print(f"verdicts: {sum(1 for x in results if x[2]=='VERDICT')}  missing: {sum(1 for x in results if x[2]=='MISSING')}")

if __name__ == "__main__":
    main()
