import test from "node:test";
import assert from "node:assert/strict";
import { canTransition } from "../lib/order-state.mjs";
test("normal preparation sequence and cancellation", () => {
  for (const [from, to] of [["pending","confirmed"],["confirmed","preparing"],["preparing","ready"],["ready","collected"],["preparing","cancelled"]]) assert.equal(canTransition(from,to),true);
});
test("terminal, skipped and invalid states cannot transition", () => {
  for (const [from,to] of [["pending","ready"],["collected","cancelled"],["cancelled","confirmed"],["unknown","pending"],["__proto__","pending"]]) assert.equal(canTransition(from,to),false);
});
