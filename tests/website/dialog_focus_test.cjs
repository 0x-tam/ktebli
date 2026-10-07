const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const html = fs.readFileSync("index.html", "utf8");
const listener = html.match(
  /document\.addEventListener\('keydown', function\(e\)\{[\s\S]*?\n\}\);/,
);
assert.ok(listener, "proposal dialog keyboard handler is present");

let document;
function control({ tabIndex = 0, visible = true, disabled = false } = {}) {
  return {
    tabIndex,
    disabled,
    hidden: false,
    focused: false,
    contains(element) {
      return element === this;
    },
    getClientRects: () => (visible ? [{ width: 10, height: 10 }] : []),
    focus() {
      this.focused = true;
      document.activeElement = this;
    },
  };
}

const close = control();
const first = control();
const hiddenStepControl = control({ visible: false });
const hiddenAncestorControl = control();
const negativeTabIndex = control({ tabIndex: -1 });
const opportunitySummary = control();
const collapsedSelect = control();
const disabledContinue = control({ disabled: true });
const focusable = [
  close,
  first,
  hiddenStepControl,
  hiddenAncestorControl,
  negativeTabIndex,
  opportunitySummary,
  collapsedSelect,
  disabledContinue,
];
const collapsedDetails = {
  tagName: "DETAILS",
  open: false,
  hidden: false,
  parentElement: null,
  querySelector: () => opportunitySummary,
};
const hiddenWrapper = { hidden: true, parentElement: null };
hiddenAncestorControl.parentElement = hiddenWrapper;
opportunitySummary.parentElement = collapsedDetails;
collapsedSelect.parentElement = collapsedDetails;
let keydown;
const dialog = {
  classList: { contains: (name) => name === "open" },
  contains: (element) => focusable.includes(element),
  querySelectorAll: () => focusable,
};
collapsedDetails.parentElement = dialog;
hiddenWrapper.parentElement = dialog;
for (const element of [
  close,
  first,
  hiddenStepControl,
  negativeTabIndex,
  disabledContinue,
]) {
  element.parentElement = dialog;
}
document = {
  activeElement: {},
  addEventListener: (name, handler) => {
    if (name === "keydown") keydown = handler;
  },
  getElementById: () => close,
};
vm.runInNewContext(listener[0], {
  document,
  wiz: { el: dialog },
  getComputedStyle: () => ({ visibility: "visible" }),
});

function press(key, shiftKey = false) {
  const event = {
    key,
    shiftKey,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  keydown(event);
  return event;
}

let event = press("Tab");
assert.equal(event.prevented, true);
assert.equal(
  document.activeElement,
  close,
  "focus entering the dialog is contained at its first control",
);
event = press("Tab", true);
assert.equal(event.prevented, true);
assert.equal(
  document.activeElement,
  opportunitySummary,
  "Shift+Tab from the first control wraps to the last visible summary when Continue is disabled",
);
event = press("Tab");
assert.equal(event.prevented, true);
assert.equal(
  document.activeElement,
  close,
  "Tab from the final visible summary wraps to the first control",
);
assert.equal(hiddenStepControl.focused, false);
assert.equal(hiddenAncestorControl.focused, false);
assert.equal(negativeTabIndex.focused, false);
assert.equal(collapsedSelect.focused, false);
assert.equal(disabledContinue.focused, false);
console.log("Proposal dialog contains focus and wraps at visible controls.");
