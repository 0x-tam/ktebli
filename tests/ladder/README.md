# The referent ladder — fixture, packets and blinding check

Everything here was previously in a scratch directory under `/tmp` belonging to a session
that has since ended. One container reclaim would have destroyed the ability to check any
verdict in `reports/design/ladder-critics/` ever again. It is now in the repo.

## SYNTHETIC FIXTURE — nothing here is a fact about a real organisation

Halewater Commons Trust, Kelverton, Marlpit, Ferry Bank, St Aidan's Parish Hall, Wharfside
Boathouse, Dunmore Sixth Form College, Barrowfield Youth Justice Team, Northgate Minibus
Hire, Redgate Catering, Priya Raval, Delroy Ferguson, the Wren Hill Foundation and the
Neighbourhood Futures Fund are invented. The domain `halewatercommons.org.uk` is part of the
fixture and **must never be crawled or cited as a source**.

## Layout

```
documents/   the 20 ladder documents: out-<rung>-{A,B,C,D}.md
packets/     the 11 critic packets as sent (dotfiles) + the 9 .map- files
fixture/     ledgers per rung, grant.json, org.json, per-arm meta, build.py, fixture-README.md
MANIFEST.txt md5 of every preserved file
bytematch.py the blinding check
build_packet.py  builds a packet for one rung and one document order
```

`fixture/build.py` is archived **as it was**, so its `D` constant still points at the dead
scratch directory; repoint it before running. It builds the ledgers, `org.json` and
`grant.json` — not the critic packets. Packets are built by `build_packet.py`, which was
repointed at the repo and then checked: it reproduces four packets that were actually sent
(`n06thin` a and b, `n12` a and b) **byte for byte**, `--verify`.

Arms: **A** pipeline + `google/gemini-3.7-flash` · **B** pipeline + `anthropic/claude-opus-5`
· **C** single prompt + flash · **D** single prompt + opus.

The packet files keep their original leading-dot names so that every existing reference in
`reports/` resolves literally. `ls` hides them; `ls -a` or `MANIFEST.txt` shows them.

## bytematch.py — why it exists and what it proves

Blinding must be **derived from the packet at read time, never passed alongside it**. Two
separate incidents in this project came from ignoring that: an orchestrator paired packets
with the wrong maps, and then a correction to one of those cells picked the wrong packet as
the one the critic had read — and inverted a result in favour of the shipped default.

The script therefore runs two checks and trusts no `.map-` file for either:

1. **Structural.** Every packet is split into its DOC blocks and each block matched against
   all 20 documents under whitespace normalisation — against every rung, not just its own,
   so a cross-rung pairing is detected rather than silently decoded. The derived permutation
   must equal the recorded map. All 11 packets pass.
2. **Content fingerprint.** For each verdict that landed, a figure the critic quoted about a
   specific `Doc n` must appear in exactly the document the recorded decoding assigns to that
   Doc, and in no other arm at that rung. This is the only check that establishes what the
   critic actually *read*. All 11 fingerprints pass.

```
tests/ladder/bytematch.py     # exit 0 = every packet and every landed verdict checks out
```

Run it after any new verdict lands, and add that verdict's fingerprints to `FINGERPRINTS`.
A verdict with no quoted figure to fingerprint is decoded on structure alone; say so where
it is reported.
