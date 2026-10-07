import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Script } from "node:vm";

type Input = { type: string; default: string; options: string[] };
type Step = {
  name?: string;
  run?: string;
  uses?: string;
  with?: Record<string, unknown>;
  env?: Record<string, string>;
};
type Workflow = {
  on: {
    schedule: { cron: string }[];
    workflow_dispatch: { inputs: Record<string, Input> };
  };
  permissions: Record<string, string>;
  concurrency: { group: string; "cancel-in-progress": boolean };
  jobs: {
    refresh: {
      if: string;
      environment: string;
      "timeout-minutes": number;
      steps: Step[];
    };
  };
};

// js-yaml is already pinned by the membership lockfile through ESLint.
const { load } = createRequire(import.meta.url)("js-yaml") as {
  load(source: string): Workflow;
};
const workflow = load(
  readFileSync(
    new URL(
      "../../.github/workflows/membership-catalogue.yml",
      import.meta.url,
    ),
    "utf8",
  ),
);
const job = workflow.jobs.refresh;
const inputs = workflow.on.workflow_dispatch.inputs;
const refresh = job.steps.find(
  (step) => step.name === "Refresh and import official public notices",
);
assert.ok(refresh?.env);
const env = refresh.env;
const lebanon = "worldbank,mawred,ungm-curated,ppa";
const all = `${lebanon},grants-gov`;

// Evaluate the actual YAML's limited expression subset: string comparisons,
// property reads, parentheses, && and ||. GitHub string equality ignores case,
// so translate that operator for these string-only contexts. Reject added
// expression syntax explicitly.
function evaluate(
  source: string,
  event: string,
  values: Record<string, string> = {},
  enabled = "",
) {
  const expression = source.replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  assert.match(
    expression,
    /^(?:\s+|'[^']*'|(?:inputs|github|vars)\.[A-Za-z_][A-Za-z_0-9]*|==|&&|\|\||[()])+$/,
  );
  const comparable = expression.replace(
    /((?:inputs|github|vars)\.[A-Za-z_][A-Za-z_0-9]*|'[^']*')\s*==\s*((?:inputs|github|vars)\.[A-Za-z_][A-Za-z_0-9]*|'[^']*')/g,
    "equals($1, $2)",
  );
  return new Script(comparable).runInNewContext(
    {
      inputs: values,
      github: { event_name: event },
      vars: { MEMBERSHIP_CATALOG_REFRESH_ENABLED: enabled },
      equals: (left?: string, right?: string) =>
        left?.toLowerCase() === right?.toLowerCase(),
    },
    { timeout: 100 },
  ) as string | boolean | undefined;
}

function configuration(event: string, values: Record<string, string> = {}) {
  return {
    sources: evaluate(env.CATALOGUE_SOURCES, event, values),
    recent: evaluate(env.CATALOGUE_RECENT_DETAILS, event, values),
    historical: evaluate(env.CATALOGUE_BACKLOG_DETAILS, event, values),
  };
}

test("scheduled absent-input configuration is the four-source qualified PPA slice", () => {
  assert.deepEqual(configuration("schedule"), {
    sources: lebanon,
    recent: "20",
    historical: "1",
  });
  assert.deepEqual(
    configuration("schedule", {
      sources: "all",
      recent_details: "500",
      backlog_details: "300",
    }),
    configuration("schedule"),
  );
});

test("manual all retains five sources and the existing manual defaults", () => {
  assert.equal(inputs.sources.default, "all");
  assert.equal(inputs.recent_details.default, "300");
  assert.equal(inputs.backlog_details.default, "40");
  const defaults = Object.fromEntries(
    Object.entries(inputs).map(([key, input]) => [key, input.default]),
  );
  assert.deepEqual(configuration("workflow_dispatch", defaults), {
    sources: all,
    recent: "300",
    historical: "40",
  });
  assert.deepEqual(configuration("workflow_dispatch", { sources: "all" }), {
    sources: all,
    recent: "300",
    historical: "40",
  });
});

test("every approved manual scope retains every bounded detail selection", () => {
  assert.deepEqual(inputs.sources.options, [
    "all",
    "lebanon",
    "worldbank",
    "mawred",
    "ungm-curated",
    "ppa",
    "grants-gov",
  ]);
  assert.equal(inputs.sources.type, "choice");
  for (const [name, maximum] of [
    ["recent_details", 500],
    ["backlog_details", 300],
  ] as const) {
    assert.equal(inputs[name].type, "choice");
    assert.ok(inputs[name].options.includes(inputs[name].default));
    for (const value of inputs[name].options) {
      assert.match(value, /^\d+$/);
      assert.ok(Number(value) >= 1 && Number(value) <= maximum);
    }
  }
  for (const scope of inputs.sources.options) {
    for (const recent of inputs.recent_details.options) {
      for (const historical of inputs.backlog_details.options) {
        assert.deepEqual(
          configuration("workflow_dispatch", {
            sources: scope,
            recent_details: recent,
            backlog_details: historical,
          }),
          {
            sources:
              scope === "all" ? all : scope === "lebanon" ? lebanon : scope,
            recent,
            historical,
          },
        );
      }
    }
  }
});

test("activation gate, restricted environment and runner guards remain intact", () => {
  for (const disabled of ["", "false"]) {
    assert.equal(evaluate(job.if, "schedule", {}, disabled), false);
    assert.equal(evaluate(job.if, "workflow_dispatch", {}, disabled), true);
  }
  assert.equal(evaluate(job.if, "schedule", {}, "true"), true);
  assert.equal(evaluate(job.if, "schedule", {}, "TRUE"), true);
  assert.deepEqual(workflow.on.schedule, [{ cron: "17 2 * * *" }]);
  assert.equal(job.environment, "membership-catalogue");
  assert.equal(job["timeout-minutes"], 90);
  assert.deepEqual(workflow.permissions, { contents: "read" });
  assert.deepEqual(workflow.concurrency, {
    group: "membership-public-catalogue",
    "cancel-in-progress": false,
  });
  assert.equal(job.steps[0].with?.["persist-credentials"], false);
  assert.equal(
    env.INGEST_DATABASE_URL,
    "${{ secrets.MEMBERSHIP_INGEST_DATABASE_URL }}",
  );
  assert.equal(
    env.MEMBERSHIP_EXPECTED_DB_HOST,
    "ep-autumn-feather-b1fk17te.c-5.eu-central-1.aws.neon.tech",
  );
  assert.equal(refresh.run, "npm run catalog:scheduled");
  for (const step of job.steps) {
    assert.doesNotMatch(step.run ?? "", /\$\{\{\s*inputs\./);
  }
  const runner = readFileSync(
    new URL("../scripts/run-catalogue.ts", import.meta.url),
    "utf8",
  );
  assert.match(runner, /const stopAt = Date\.now\(\) \+ 80 \* 60 \* 1000;/);
  assert.match(runner, /connectionHost !== expectedHost/);
  assert.match(
    runner,
    /boundedDetails\("CATALOGUE_RECENT_DETAILS", 300, 500\)/,
  );
  assert.match(
    runner,
    /boundedDetails\("CATALOGUE_BACKLOG_DETAILS", 40, 300\)/,
  );
  // Environment branch policy and variable values are external GitHub state;
  // this local test proves only that the workflow keeps that environment/gate.
});
