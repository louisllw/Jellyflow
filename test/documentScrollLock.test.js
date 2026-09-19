import test from "node:test";
import assert from "node:assert/strict";
import { lockDocumentScroll } from "../src/components/documentScrollLock.js";

test("player scroll lock freezes and restores the document position", () => {
  const body = {
    style: {
      overflow: "auto",
      position: "",
      top: "",
      left: "",
      right: "",
      width: "",
      paddingRight: "2px",
    },
  };
  const root = { style: { overflow: "clip" }, clientWidth: 1180 };
  const scrollCalls = [];
  const win = {
    scrollY: 420,
    innerWidth: 1200,
    getComputedStyle: () => ({ paddingRight: "2px" }),
    scrollTo: (...args) => scrollCalls.push(args),
  };

  const unlock = lockDocumentScroll({ body, documentElement: root }, win);
  assert.equal(root.style.overflow, "hidden");
  assert.equal(body.style.position, "fixed");
  assert.equal(body.style.top, "-420px");
  assert.equal(body.style.paddingRight, "22px");

  unlock();
  assert.equal(root.style.overflow, "clip");
  assert.equal(body.style.overflow, "auto");
  assert.equal(body.style.position, "");
  assert.equal(body.style.top, "");
  assert.equal(body.style.paddingRight, "2px");
  assert.deepEqual(scrollCalls, [[0, 420]]);
});
