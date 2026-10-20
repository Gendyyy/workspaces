/**
 * Hit regions recorded while rendering. The renderer tags segments, the painter
 * records the columns it drew, and mouse handling looks the tags up by cell.
 */
import type { HitAction } from "./actions.ts";

/** One clickable column span on a rendered line. */
export interface Hit {
	/** Inclusive column start, local to the panel component. */
	start: number;
	/** Exclusive column end. */
	end: number;
	action: HitAction;
}

/** One rendered line: its clickable spans and, for list rows, its entry index. */
export interface FrameRow {
	hits: Hit[];
	/** Entry (or folder row) index under this line, when the line is a row. */
	rowIndex?: number;
}

/** The layout of the last frame, indexed by absolute line within the component. */
export interface Frame {
	rows: FrameRow[];
}

/** Pointer position in component-local cells. */
export interface Hover {
	y: number;
	x: number;
}

/** Find the action painted under a cell; the last painted span wins. */
export function hitAt(frame: Frame | undefined, y: number, x: number): HitAction | undefined {
	const row = frame?.rows[y];
	if (!row) return undefined;
	for (let index = row.hits.length - 1; index >= 0; index -= 1) {
		const hit = row.hits[index];
		if (x >= hit.start && x < hit.end) return hit.action;
	}
	return undefined;
}

/** Find the list entry or folder row painted on a line. */
export function rowIndexAt(frame: Frame | undefined, y: number): number | undefined {
	return frame?.rows[y]?.rowIndex;
}

/** True when two pointer positions are the same cell. */
export function sameHover(left: Hover | undefined, right: Hover | undefined): boolean {
	if (!left || !right) return left === right;
	return left.y === right.y && left.x === right.x;
}
