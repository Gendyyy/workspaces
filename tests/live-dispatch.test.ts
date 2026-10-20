/**
 * End-to-end mouse test: drives the panel through pi-tui's real fullscreen
 * overlay dispatch so coordinate offsets, SGR parsing, and press/click pairing
 * are exercised exactly as the live TUI does it.
 */
import { describe, expect, test } from "bun:test";
import { TuiAltScreen, stripTerminalSequences, visibleWidth, type Terminal } from "@earendil-works/pi-tui";
import { PanelHarness, WIDTH } from "./harness.ts";

const COLS = 120;
const ROWS = 40;

/** Minimal terminal that captures the input handler and ignores writes. */
class FakeTerminal implements Terminal {
	columns = COLS;
	rows = ROWS;
	kittyProtocolActive = false;
	input?: (data: string) => void;
	resize?: () => void;
	written: string[] = [];

	start(onInput: (data: string) => void, onResize: () => void): void {
		this.input = onInput;
		this.resize = onResize;
	}
	stop(): void {}
	async drainInput(): Promise<void> {}
	write(data: string): void {
		this.written.push(data);
	}
	moveBy(): void {}
	hideCursor(): void {}
	showCursor(): void {}
	clearLine(): void {}
	clearFromCursor(): void {}
	clearScreen(): void {}
	setTitle(): void {}
	setProgress(): void {}
	setProgramStatus(): void {}
}

/** A live fullscreen TUI hosting the panel as a centered overlay. */
class LiveTui {
	readonly terminal = new FakeTerminal();
	readonly tui: TuiAltScreen;
	readonly harness = new PanelHarness();

	constructor() {
		this.tui = new TuiAltScreen(this.terminal as unknown as TuiTerminal, false, undefined);
	}

	/** Mount the overlay, start the screen, and paint one frame. */
	mount(): void {
		this.tui.showOverlay(this.harness.panel, { anchor: "center", width: WIDTH, maxHeight: "90%" });
		this.tui.start();
		this.tui.renderNow(true);
	}

	/** Locate the first cell of a substring in the last painted frame. */
	cell(needle: string): { row: number; col: number } {
		const lines = this.tui.getScreenLines();
		for (let row = 0; row < lines.length; row++) {
			const plain = stripTerminalSequences(lines[row] ?? "");
			const index = plain.indexOf(needle);
			if (index !== -1) {
				return { row, col: visibleWidth(plain.slice(0, index)) };
			}
		}
		throw new Error(`text not found in frame: ${needle}\n${lines.map(stripTerminalSequences).join("\n")}`);
	}

	/** Send one SGR mouse report (1-based terminal coordinates). */
	send(release: boolean, point: { row: number; col: number }): void {
		const sequence = `\x1b[<0;${point.col + 1};${point.row + 1}${release ? "m" : "M"}`;
		this.terminal.input?.(sequence);
	}

	/** Press and release on a rendered substring, like a real pointer. */
	click(needle: string): void {
		const point = this.cell(needle);
		this.send(false, point);
		this.send(true, point);
	}

	/** Repaint after a state change, as pi would on the next frame. */
	repaint(): void {
		this.tui.renderNow(true);
	}
}

type TuiTerminal = ConstructorParameters<typeof TuiAltScreen>[0];

describe("live overlay mouse dispatch", () => {
	test("mounts the panel where the pointer can reach it", () => {
		const live = new LiveTui();
		live.mount();
		const lines = live.tui.getScreenLines().map(stripTerminalSequences);
		expect(lines.some((line) => line.includes("Alpha session 7"))).toBe(true);
	});

	test("a real click on a session row switches to that session", () => {
		const live = new LiveTui();
		live.mount();
		live.click("Alpha session 3");
		expect(live.harness.actions).toEqual([{ type: "switch", sessionPath: "/tmp/sessions/Alpha session 3.jsonl" }]);
	});

	test("a real click on the close control closes the panel", () => {
		const live = new LiveTui();
		live.mount();
		live.click("✕");
		expect(live.harness.actions).toEqual([{ type: "cancel" }]);
	});

	test("a real click on a hint button runs that action", () => {
		const live = new LiveTui();
		live.mount();
		live.click("esc close");
		expect(live.harness.actions).toEqual([{ type: "cancel" }]);
	});

	test("a real click on a workspace row collapses it", () => {
		const live = new LiveTui();
		live.mount();
		live.click("beta");
		live.repaint();
		const lines = live.tui.getScreenLines().map(stripTerminalSequences);
		expect(lines.some((line) => line.includes("Beta session"))).toBe(true);
	});
});
