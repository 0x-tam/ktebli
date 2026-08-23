// Retired test harness. The one-off visual-QA production proof (2026-08-22) is
// complete; this stub does nothing and holds no code, keys, or data access.
// Safe to delete from the dashboard at any time.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
Deno.serve(() => new Response(JSON.stringify({ ok: false, code: "gone" }), { status: 410, headers: { "content-type": "application/json" } }));
