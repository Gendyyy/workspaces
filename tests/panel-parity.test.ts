/**
 * Parity tests: every clickable hint button has a keyboard equivalent, and the
 * modal flows behave the same whichever input drives them.
 */
import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalPath, expandHome } from "../extensions/workspaces/data.ts";
import { hintRowsFor, type HitAction } from "../extensions/workspaces/panel/actions.ts";
import { deleteKeyAction, folderKeyAction, listKeyAction, renameKeyAction } from "../extensions/workspaces/panel/keys.ts";
import { PanelHarness } from "./harness.ts";

/** Flatten a mode's hint rows into one button list. */
function buttons(mode: "list" | "rename" | "confirm-delete" | "folder" | "move-folder") {
	return hintRowsFor(mode).flat();
}

describe("hint buttons", () => {
	test("every button carries an action", () => {
		for (const mode of ["list", "rename", "confirm-delete", "folder", "move-folder"] as const) {
			for (const button of buttons(mode)) expect(button.action).toBeDefined();
		}
	});

	test("labels are unique within a row", () => {
		for (const mode of ["list", "rename", "confirm-delete", "folder", "move-folder"] as const) {
			for (const row of hintRowsFor(mode)) {
				const labels = row.map((button) => button.label);
				expect(new Set(labels).size).toBe(labels.length);
			}
		}
	});
});

describe("keyboard parity", () => {
	const LIST_KEYS: [string, string][] = [
		["\r", "activate"],
		["/", "focus-search"],
		["n", "new-session"],
		["m", "move"],
		["a", "attach"],
		["o", "browse"],
		["s", "toggle-sort"],
		["h", "toggle-hidden"],
		["x", "hide-workspace"],
		["r", "rename"],
		["d", "delete"],
		["\x12", "toggle-regex"],
	];

	test("each list button has the same action as its key", () => {
		const list = buttons("list");
		for (const [key, type] of LIST_KEYS) {
			expect(listKeyAction(key, true)).toEqual(expectedAction(list, type));
		}
	});

	test("escape closes the panel", () => {
		const h = new PanelHarness();
		h.render();
		h.key("\x1b");
		expect(h.actions).toEqual([{ type: "cancel" }]);
	});

	test("folder buttons match folder keys", () => {
		const folder = buttons("folder");
		const expected: [string, string][] = [
			["\r", "activate-folder"],
			["\t", "folder-create"],
		];
		for (const [key, type] of expected) {
			expect(folderKeyAction(key)).toEqual(expectedAction(folder, type));
		}
	});

	test("move folder confirmation matches Enter and Tab", () => {
		const folder = buttons("move-folder");
		expect(folderKeyAction("\r", true)).toEqual(expectedAction(folder, "folder-move"));
		expect(folderKeyAction("\t", true)).toEqual(expectedAction(folder, "folder-move"));
	});

	test("rename buttons match rename keys", () => {
		expect(renameKeyAction("\r")).toEqual(expectedAction(buttons("rename"), "save-rename"));
	});

	test("delete buttons match delete keys", () => {
		const del = buttons("confirm-delete");
		expect(deleteKeyAction("y")).toEqual(expectedAction(del, "confirm-delete"));
		expect(deleteKeyAction("n")).toEqual(expectedAction(del, "cancel-mode"));
	});
});

/** Look up the action a hint button with a given type carries. */
function expectedAction(list: ReturnType<typeof buttons>, type: string): HitAction {
	const action = list.find((candidate) => candidate.action?.type === type)?.action;
	if (!action) throw new Error(`no hint button carries ${type}`);
	return action;
}

describe("directory path input", () => {
	test("expands forward- and backslash home paths", () => {
		expect(expandHome("~/workspaces")).toBe(join(homedir(), "workspaces"));
		expect(expandHome("~\\workspaces")).toBe(join(homedir(), "workspaces"));
	});
});

describe("modal flows", () => {
	test("m lists other active workspaces and Enter selects the destination", () => {
		const h = new PanelHarness();
		h.render();
		h.key("\x1b[B");
		h.key("m");
		const folder = h.render().join("\n");
		expect(folder).toContain("Move session");
		expect(folder).toContain("beta");
		expect(folder).not.toContain("Move session here");
		h.key("\r");
		expect(h.actions).toEqual([{
			type: "move-session",
			sessionPath: "/tmp/sessions/Alpha session 7.jsonl",
			targetCwd: "/tmp/beta",
			isCurrent: false,
		}]);
	});

	test("typing an absolute path creates a custom destination", () => {
		const h = new PanelHarness();
		h.render();
		h.key("\x1b[B");
		h.key("m");
		h.key(homedir());
		expect(h.render().join("\n")).toContain("Use ");
		h.key("\t");
		expect(h.actions[0]).toMatchObject({
			type: "move-session",
			targetCwd: canonicalPath(homedir()),
		});
	});

	test("rename saves the edited title through the save button", () => {
		const h = new PanelHarness();
		h.render();
		h.press("Alpha session 4");
		h.click("r rename");
		expect(h.render().join("\n")).toContain("rename Alpha session 4");
		h.click("⏎ save");
		expect(h.renameCalls).toEqual([
			{ sessionPath: "/tmp/sessions/Alpha session 4.jsonl", name: "Alpha session 4" },
		]);
	});

	test("delete asks for confirmation and removes the session", async () => {
		const h = new PanelHarness();
		h.render();
		h.press("Alpha session 4");
		h.click("d delete");
		expect(h.render().join("\n")).toContain('delete "Alpha session 4"?');
		h.click("y delete");
		await Bun.sleep(1);
		expect(h.removeCalls).toEqual(["/tmp/sessions/Alpha session 4.jsonl"]);
		expect(h.render().join("\n")).toContain("Deleted");
	});

	test("delete can be cancelled from the row prompt", async () => {
		const h = new PanelHarness();
		h.render();
		h.press("Alpha session 4");
		h.click("d delete");
		h.render();
		h.click("n cancel");
		await Bun.sleep(1);
		expect(h.removeCalls).toEqual([]);
		expect(h.render().join("\n")).toContain("Workspaces");
	});
});
