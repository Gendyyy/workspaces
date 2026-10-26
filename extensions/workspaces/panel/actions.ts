/**
 * The panel's action vocabulary: one union for keyboard, mouse, and hint
 * buttons, plus the outcome type the extension applies after the panel closes.
 */

/** What the panel resolves to; only a command context may perform these. */
export type PanelAction =
	| { type: "cancel" }
	| { type: "switch"; sessionPath: string }
	| { type: "new-session"; cwd: string }
	| { type: "move-session"; sessionPath: string; targetCwd: string; isCurrent: boolean }
	| { type: "attach-workspace" };

/** A user intention. Keys, rows, and buttons all produce these. */
export type HitAction =
	| { type: "activate" }
	| { type: "move-selection"; delta: number }
	| { type: "move-folder-selection"; delta: number }
	| { type: "expand-selected"; expanded: boolean }
	| { type: "new-session" }
	| { type: "move" }
	| { type: "attach" }
	| { type: "browse" }
	| { type: "hide-workspace" }
	| { type: "rename" }
	| { type: "delete" }
	| { type: "toggle-hidden" }
	| { type: "toggle-sort" }
	| { type: "toggle-regex" }
	| { type: "focus-search" }
	| { type: "clear-filter" }
	| { type: "close" }
	| { type: "save-rename" }
	| { type: "cancel-mode" }
	| { type: "confirm-delete" }
	| { type: "folder-open"; path: string }
	| { type: "folder-create" }
	| { type: "folder-move"; path?: string }
	| { type: "folder-back" }
	| { type: "activate-folder" };

/** One clickable label in the hint bar. A label without an action is plain text. */
export interface HintButton {
	label: string;
	action?: HitAction;
}

const LIST_HINT_ROWS: readonly (readonly HintButton[])[] = [
	[
		{ label: "⏎ open", action: { type: "activate" } },
		{ label: "/ find", action: { type: "focus-search" } },
		{ label: "n new", action: { type: "new-session" } },
		{ label: "m move", action: { type: "move" } },
		{ label: "a add", action: { type: "attach" } },
		{ label: "o dirs", action: { type: "browse" } },
		{ label: "esc close", action: { type: "close" } },
	],
	[
		{ label: "s sort", action: { type: "toggle-sort" } },
		{ label: "h hidden", action: { type: "toggle-hidden" } },
		{ label: "x hide", action: { type: "hide-workspace" } },
		{ label: "r rename", action: { type: "rename" } },
		{ label: "d delete", action: { type: "delete" } },
		{ label: "^R regex", action: { type: "toggle-regex" } },
	],
];

const RENAME_HINT_ROWS: readonly (readonly HintButton[])[] = [
	[
		{ label: "⏎ save", action: { type: "save-rename" } },
		{ label: "esc cancel", action: { type: "cancel-mode" } },
	],
];

const DELETE_HINT_ROWS: readonly (readonly HintButton[])[] = [
	[
		{ label: "y delete", action: { type: "confirm-delete" } },
		{ label: "n cancel", action: { type: "cancel-mode" } },
	],
];

const FOLDER_HINT_ROWS: readonly (readonly HintButton[])[] = [
	[
		{ label: "⏎ open", action: { type: "activate-folder" } },
		{ label: "tab here", action: { type: "folder-create" } },
		{ label: "esc back", action: { type: "folder-back" } },
	],
];

const MOVE_FOLDER_HINT_ROWS: readonly (readonly HintButton[])[] = [
	[
		{ label: "⏎ move", action: { type: "folder-move" } },
		{ label: "tab move", action: { type: "folder-move" } },
		{ label: "esc back", action: { type: "folder-back" } },
	],
];

/** Pick the hint rows for the current mode. */
export function hintRowsFor(mode: "list" | "rename" | "confirm-delete" | "folder" | "move-folder"): readonly (readonly HintButton[])[] {
	if (mode === "rename") return RENAME_HINT_ROWS;
	if (mode === "confirm-delete") return DELETE_HINT_ROWS;
	if (mode === "move-folder") return MOVE_FOLDER_HINT_ROWS;
	if (mode === "folder") return FOLDER_HINT_ROWS;
	return LIST_HINT_ROWS;
}

/** Compare actions by value, so tests and guards can reason about intent. */
export function sameAction(left: HitAction, right: HitAction): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}
