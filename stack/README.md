# The local stack

Ktebli has never run end to end against a live crawl. Every measurement so far replayed the
generation path offline, and the twelve UK Youth facts came out of a report rather than the
crawler. The first time this pipeline meets a real nonprofit's website must not be the first
time a customer has paid for it.

This runs the whole thing locally, on Ubuntu.

```
sudo stack/guard-egress.sh     # make production unreachable, and verify it
cp stack/env.example stack/.env && $EDITOR stack/.env
stack/up.sh                    # postgres, migrations, parity check, vault
supabase functions serve --env-file stack/.env   # second terminal
stack/live-run.sh sites.txt    # the six-site live crawl
```

## What runs here is what runs in production

Same migrations, same edge functions, same `config.toml`. The only differences are
environmental: which database it points at, and what is in the Vault. There is deliberately
**no local-only code path** — adding one would mean the thing verified here is not the thing
that ships.

The two migration hazards are already corrected in `20260820145930`, and this stack depends on
that correction rather than working around it: the cron target is read from a Vault secret
(`worker_url`), which `up.sh` sets to the *local* functions endpoint. A replayed history cannot
inherit production's URL, because the URL is no longer in the history.

## Production is unreachable, not merely unconfigured

`guard-egress.sh` blackholes `uocauqflcqefgdixbzpf.supabase.co` in `/etc/hosts` and verifies the
host stops answering. `up.sh` refuses to start without it. A stale Vault row, a copied env var
or a mistyped flag hits a closed socket rather than a live customer's worker.

The guard is environmental on purpose. Putting it in the code would create a path that exists
only because the environment is local.

## Stripe and Resend are stubbed

Neither key is in `env.example`. Without a Resend key `sendEmail` returns false, so no mail
leaves the machine; without Stripe no charge can be made. A local run cannot touch a real
customer or a real card.

## What this cannot test

Stated plainly rather than assumed away.

**Production's deployed runtime.** Edge-function invocation limits, cold starts, and the
807-second heartbeat loss that kills Competitive and Full are properties of Supabase's
platform, not of the code. They will not reproduce here.

**So resumability is not proven by a local run.** It gets built to be correct by construction
and verified on the first real orders. Do not report a green local run as evidence that the
completion problem is fixed.

**Nor is throughput, cold-start latency, or the 5-to-30-minute delivery promise.** Those are
launch-shape observations, watched per order on the first real customers.

## Chromium, and what it is for

`ground-truth.sh` renders each site with a real browser and counts the named referents a
person would see. The six-site run compares that against what the crawler extracted:

- a large gap on a site the crawler called `succeeded` is an **extraction bug**
- a large gap on one it called `js_only` is the **taxonomy working correctly**

"The crawler got nothing" and "there was nothing to get" are different findings and only one
of them is a bug. Without ground truth they are indistinguishable, which is how the silent
failure survived this long.

The browser is a **test harness only**. The production crawler is a Deno edge function doing
one fetch per page with no JavaScript engine, and that stays true — eight functions, no new
services. A JS-rendered site is reported as `js_only`, not worked around.

### TLS trust for Chromium

Chromium keeps its own NSS trust store, so it does not pick up the system CA bundle:

```
apt-get install -y libnss3-tools
mkdir -p ~/.pki/nssdb && certutil -d sql:$HOME/.pki/nssdb -N --empty-password
cd /tmp && csplit -z -f cert- -b '%03d.pem' /path/to/ca-bundle.crt '/BEGIN CERTIFICATE/' '{*}'
for f in cert-*.pem; do certutil -d sql:$HOME/.pki/nssdb -A -t "C,," -n "ca-$f" -i "$f"; done
```

Note `certutil -A` imports only the **first** certificate in a bundle, which is why the bundle
is split first. On a machine behind a TLS-inspecting proxy, skipping this produces a "Your
connection is not private" page that looks exactly like a site being down.
