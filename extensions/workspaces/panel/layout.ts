/**
 * Painting and box composition. One painter both draws styled segments and
 * records the columns they occupy, so click targets can never drift from the
 * pixels they belong to.
 */
import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { HitAction } from "./actions.ts";
import type { Frame, Hit, Hover } from "./hits.ts";

/** One styled run of text that may carry a click action. */
export interface Seg {
	text: string;
	color?: ThemeColor;
	bold?: boolean;
	hit?: HitAction;
}

/** One line inside the box, optionally rendered as a selected row. */
export interface LayoutLine {
	segs: Seg[];
	selected?: boolean;
	/** Entry or folder-row index painted on this line, used to select on press. */
	rowIndex?: number;
}

export interface BoxSpec {
	/** Header content, left-aligned after the corner. */
	left: Seg[];
	/** Header content, right-aligned before the corner. */
	right?: Seg[];
	lines: LayoutLine[];
	width: number;
	theme: Theme;
	hover?: Hover;
}

export interface Box {
	lines: string[];
	frame: Frame;
}

interface PaintOptions {
	width: number;
	theme: Theme;
	line: number;
	hover?: Hover;
	hits?: Hit[];
}

/** Draw segments into a fixed width, recording a hit span for every tagged run. */
function paintSegs(segs: Seg[], options: PaintOptions): string {
	const { width, theme, line, hover, hits } = options;
	let remaining = width;
	let column = 0;
	let out = "";
	for (const seg of segs) {
		if (remaining <= 0) break;
		const piece = truncateToWidth(seg.text, remaining, "…");
		const pieceWidth = visibleWidth(piece);
		if (seg.hit && hits) hits.push({ start: column, end: column + pieceWidth, action: seg.hit });
		if (pieceWidth > 0) {
			const hovered =
				hover !== undefined && hover.y === line && hover.x >= column && hover.x < column + pieceWidth;
			if (hovered) {
				// Accent plus underline makes the pointer target obvious without moving it.
				out += theme.style(piece, { fg: "accent", bold: true, underline: true });
			} else if (seg.color || seg.bold) {
				out += theme.style(piece, { fg: seg.color ?? "text", bold: seg.bold });
			} else {
				out += piece;
			}
		}
		column += pieceWidth;
		remaining -= pieceWidth;
	}
	return out + " ".repeat(Math.max(0, remaining));
}

/** Draw a selected row with a filled background while keeping its hit spans. */
function paintSelected(segs: Seg[], width: number, theme: Theme, hits: Hit[]): string {
	let remaining = width;
	let column = 0;
	for (const seg of segs) {
		if (remaining <= 0) break;
		const piece = truncateToWidth(seg.text, remaining, "…");
		const pieceWidth = visibleWidth(piece);
		if (seg.hit) hits.push({ start: column, end: column + pieceWidth, action: seg.hit });
		column += pieceWidth;
		remaining -= pieceWidth;
	}
	const plain = truncateToWidth(segs.map((seg) => seg.text).join(""), width, "…");
	const padded = plain + " ".repeat(Math.max(0, width - visibleWidth(plain)));
	return theme.style(padded, { bg: "selectedBg", fg: "text", bold: true });
}

/** Lay out header text: left content, dash fill, right content. */
function headerSegs(left: Seg[], right: Seg[], width: number): Seg[] {
	const used = [...left, ...right].reduce((total, seg) => total + visibleWidth(seg.text), 0);
	const fill = Math.max(0, width - used - 1);
	const segs: Seg[] = [...left];
	if (fill > 0) segs.push({ text: "─".repeat(fill), color: "border" });
	else segs.push({ text: " ", color: "border" });
	segs.push(...right);
	return segs;
}

/** Compose the bordered box and return both text and the frame's hit map. */
export function composeBox(spec: BoxSpec): Box {
	const { theme, width } = spec;
	const innerW = Math.max(1, width - 2);
	const lines: string[] = [];
	const frame: Frame = { rows: [] };

	const headerHits: Hit[] = [];
	const painted = paintSegs(headerSegs(spec.left, spec.right ?? [], innerW), {
		width: innerW,
		theme,
		line: 0,
		hover: spec.hover,
		hits: headerHits,
	});
	lines.push(theme.fg("border", "╭") + painted + theme.fg("border", "╮"));
	frame.rows.push({ hits: headerHits });

	spec.lines.forEach((line, index) => {
		const y = index + 1;
		const hits: Hit[] = [];
		const body = line.selected
			? paintSelected(line.segs, innerW, theme, hits)
			: paintSegs(line.segs, { width: innerW, theme, line: y, hover: spec.hover, hits });
		lines.push(theme.fg("border", "│") + body + theme.fg("border", "│"));
		frame.rows.push({ hits, rowIndex: line.rowIndex });
	});

	lines.push(theme.fg("border", `╰${"─".repeat(innerW)}╯`));
	frame.rows.push({ hits: [] });
	return { lines, frame };
}

/** A full-width separator line inside the box. */
export function separator(innerW: number): LayoutLine {
	return { segs: [{ text: "─".repeat(innerW), color: "borderMuted" }] };
}

/** An intentionally empty line, used to pad short lists. */
export function emptyLine(): LayoutLine {
	return { segs: [{ text: "" }] };
}

/** Render a hint bar as buttons that fit the available width. */
export function hintLine(buttons: readonly { label: string; action?: HitAction }[], innerW: number): LayoutLine {
	const segs: Seg[] = [{ text: " " }];
	let used = 1;
	let placed = 0;
	for (const button of buttons) {
		const addition = `${placed === 0 ? "" : " · "}${button.label}`;
		if (used + visibleWidth(addition) > innerW - 1) break;
		if (placed > 0) segs.push({ text: " · ", color: "dim" });
		segs.push({ text: button.label, color: "dim", hit: button.action });
		used += visibleWidth(addition);
		placed += 1;
	}
	if (placed === 0 && buttons[0]) {
		segs.push({ text: truncateToWidth(buttons[0].label, Math.max(1, innerW - 2), "…"), color: "dim" });
	}
	return { segs };
}
