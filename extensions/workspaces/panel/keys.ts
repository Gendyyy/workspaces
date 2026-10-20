/**
 * Key mappings for the panel. Every key resolves to a HitAction, so keyboard and
 * pointer input reach the same dispatcher instead of duplicating behaviour.
 */
import { Key, matchesKey } from "@earendil-works/pi-tui";
import type { HitAction } from "./actions.ts";

/** Restore printable characters from a keypress, ignoring escape sequences. */
export function printable(data: string): string | undefined {
	if (!data || data.startsWith("\x1b")) return undefined;
	const cleaned = data.replace(/[\x00-\x1f\x7f]/g, "");
	return cleaned.length > 0 ? cleaned : undefined;
}

/** Map a list-mode keypress; letter shortcuts fire only outside search. */
export function listKeyAction(data: string, singleKey: boolean): HitAction | undefined {
	if (matchesKey(data, Key.up)) return { type: "move-selection", delta: -1 };
	if (matchesKey(data, Key.down)) return { type: "move-selection", delta: 1 };
	if (matchesKey(data, Key.pageUp)) return { type: "move-selection", delta: -5 };
	if (matchesKey(data, Key.pageDown)) return { type: "move-selection", delta: 5 };
	if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) return { type: "activate" };
	if (matchesKey(data, Key.tab) || matchesKey(data, Key.left)) return { type: "expand-selected", expanded: false };
	if (matchesKey(data, Key.right) || matchesKey(data, Key.ctrl("l"))) return { type: "expand-selected", expanded: true };
	if (matchesKey(data, Key.ctrl("r"))) return { type: "toggle-regex" };
	if (matchesKey(data, Key.ctrl("u"))) return { type: "clear-filter" };
	if (matchesKey(data, Key.ctrl("n"))) return { type: "move-selection", delta: 1 };
	if (matchesKey(data, Key.ctrl("p"))) return { type: "move-selection", delta: -1 };
	if (!singleKey) return undefined;
	switch (data) {
		case "/":
			return { type: "focus-search" };
		case "n":
			return { type: "new-session" };
		case "a":
			return { type: "attach" };
		case "o":
			return { type: "browse" };
		case "r":
			return { type: "rename" };
		case "d":
			return { type: "delete" };
		case "x":
			return { type: "hide-workspace" };
		case "h":
			return { type: "toggle-hidden" };
		case "s":
			return { type: "toggle-sort" };
		case "q":
			return { type: "close" };
		default:
			return undefined;
	}
}

/** Map a folder-browser keypress. Typed text is handled by the caller. */
export function folderKeyAction(data: string): HitAction | undefined {
	if (matchesKey(data, Key.up)) return { type: "move-folder-selection", delta: -1 };
	if (matchesKey(data, Key.down)) return { type: "move-folder-selection", delta: 1 };
	if (matchesKey(data, Key.pageUp)) return { type: "move-folder-selection", delta: -5 };
	if (matchesKey(data, Key.pageDown)) return { type: "move-folder-selection", delta: 5 };
	if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) return { type: "activate-folder" };
	if (matchesKey(data, Key.tab)) return { type: "folder-create" };
	return undefined;
}

/** Map a delete-confirmation keypress. */
export function deleteKeyAction(data: string): HitAction | undefined {
	if (data === "y" || data === "Y") return { type: "confirm-delete" };
	if (data === "n" || data === "N") return { type: "cancel-mode" };
	return undefined;
}

/** Map a rename keypress; typing and backspace are handled by the caller. */
export function renameKeyAction(data: string): HitAction | undefined {
	if (matchesKey(data, Key.enter) || matchesKey(data, Key.return)) return { type: "save-rename" };
	return undefined;
}
