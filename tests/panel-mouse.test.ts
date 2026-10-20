/**
 * Mouse tests for the workspaces panel: every visible control reacts to a click
 * at the coordinates where it was painted.
 */
import { describe, expect, test } from "bun:test";
import { PanelHarness, markingTheme, WIDTH } from "./harness.ts";
import { visibleWidth } from "@earendil-works/pi-tui";

describe("panel mouse", () => {
	test("clicking a session row opens that session", () => {
		const h = new PanelHarness();
		h.render();
		h.click("Alpha session 4");
		expect(h.actions).toEqual([{ type: "switch", sessionPath: "/tmp/sessions/Alpha session 4.jsonl" }]);
	});

	test("clicking a workspace row toggles its sessions", () => {
		const h = new PanelHarness();
		h.render();
		expect(h.text).not.toContain("Beta session");
		h.click("beta");
		expect(h.render().join("\n")).toContain("Beta session");
		h.click("beta");
		expect(h.render().join("\n")).not.toContain("Beta session");
	});

	test("clicking the chevron expands a collapsed workspace", () => {
		const h = new PanelHarness();
		h.render();
		h.click("▸");
		expect(h.render().join("\n")).toContain("Beta session");
	});

	test("clicking the more row pages in the remaining sessions", () => {
		const h = new PanelHarness();
		h.render();
		expect(h.text).not.toContain("Alpha session 1");
		h.click("View 2 more");
		const after = h.render().join("\n");
		expect(after).toContain("Alpha session 1");
		expect(after).not.toContain("more session");
	});

	test("a double click does not repeat the action", () => {
		const h = new PanelHarness();
		h.render();
		const point = h.locate("beta");
		h.panel.handleMouse(h.mouse("press", point));
		h.panel.handleMouse(h.mouse("click", point));
		h.panel.handleMouse(h.mouse("click", point, { clickCount: 2 }));
		expect(h.render().join("\n")).toContain("Beta session");
	});

	test("clicking the sort badge flips the sort mode", () => {
		const h = new PanelHarness();
		expect(h.render().join("\n")).toContain("sort: modified");
		h.click("sort: modified");
		expect(h.render().join("\n")).toContain("sort: created");
	});

	test("clicking the hidden badge toggles hidden workspaces", () => {
		const h = new PanelHarness();
		h.render();
		h.click("hidden off");
		const after = h.render().join("\n");
		expect(after).toContain("hidden on");
		expect(after).toContain("Hidden workspaces");
	});

	test("clicking the close control cancels the panel", () => {
		const h = new PanelHarness();
		h.render();
		h.click("✕");
		expect(h.actions).toEqual([{ type: "cancel" }]);
	});

	test("clicking the search hint focuses the filter and typing extends it", () => {
		const h = new PanelHarness();
		h.render();
		h.click("/ find");
		expect(h.render().join("\n")).toContain("⌕ ▏");
		h.key("b");
		const filtered = h.render().join("\n");
		expect(filtered).toContain("/re b");
		h.click("⌕");
		expect(h.render().join("\n")).toContain("/ to search");
	});

	test("the regex chip is clickable only while filtering", () => {
		const h = new PanelHarness();
		h.render();
		h.click("/ find");
		h.key("alpha");
		h.render();
		h.click("/re");
		expect(h.render().join("\n")).toContain(" /re ");
	});

	test("the folder browser opens, guards the create row, and starts a session", () => {
		const h = new PanelHarness();
		h.render();
		h.click("o dirs");
		const folder = h.render().join("\n");
		expect(folder).toContain("New session");
		expect(folder).toContain("Start a session in this folder");
		h.click("Start a session in this folder");
		expect(h.actions).toEqual([]);
		h.click("✓");
		expect(h.actions).toEqual([{ type: "new-session", cwd: "/tmp" }]);
	});

	test("the folder browser returns to the list", () => {
		const h = new PanelHarness();
		h.render();
		h.click("o dirs");
		h.render();
		h.click("esc back");
		expect(h.render().join("\n")).toContain("Workspaces");
	});

	test("hover is reported once per cell and does not move the selection", () => {
		const h = new PanelHarness();
		h.render();
		expect(h.move("beta")).toEqual({ handled: true, render: true });
		expect(h.move("beta")).toBeUndefined();
		h.key("\r");
		expect(h.render().join("\n")).not.toContain("Alpha session 1");
	});

	test("hover outside any painted span is ignored", () => {
		const h = new PanelHarness();
		h.render();
		const reply = h.panel.handleMouse(h.mouse("move", { y: 0, x: 0 }));
		expect(reply).toBeUndefined();
	});

	test("hits are rebuilt after a resize", () => {
		const h = new PanelHarness();
		h.render(44);
		h.render(66);
		h.click("Alpha session 3");
		expect(h.actions).toEqual([{ type: "switch", sessionPath: "/tmp/sessions/Alpha session 3.jsonl" }]);
	});

	test("hover is painted, not just recorded", () => {
		const h = new PanelHarness({ theme: markingTheme });
		const before = h.render().join("\n");
		h.move("beta");
		const after = h.render().join("\n");
		expect(after).not.toBe(before);
		expect(after).toContain("underline");
	});

	test("every frame keeps its exact width", () => {
		const h = new PanelHarness();
		for (const width of [44, 66, 90]) {
			for (const line of h.render(width)) expect(visibleWidth(line)).toBe(width);
		}
	});

	test("both hint rows fit at a narrow width", () => {
		const h = new PanelHarness();
		const text = h.render(WIDTH).join("\n");
		expect(text).toContain("esc close");
		expect(text).toContain("s sort");
		expect(text).toContain("^R regex");
	});
});
