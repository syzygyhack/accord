<script lang="ts">
	/**
	 * Drag handle for resizing sidebar columns.
	 * Dispatches width changes while the user drags; the parent applies
	 * the width to its layout container.
	 *
	 * Props:
	 * - side: 'left' | 'right' — which panel the handle is attached to.
	 *   'left' means the handle sits on the right edge of a left panel.
	 *   'right' means the handle sits on the left edge of a right panel.
	 * - min/max: pixel constraints
	 * - width: current width (bindable)
	 * - onresize: callback with new width
	 */

	interface Props {
		side: 'left' | 'right';
		min: number;
		max: number;
		width: number;
		onresize?: (width: number) => void;
	}

	let { side, min, max, width, onresize }: Props = $props();

	let dragging = $state(false);
	let startX = 0;
	let startWidth = 0;

	function handlePointerDown(e: PointerEvent): void {
		e.preventDefault();
		dragging = true;
		startX = e.clientX;
		startWidth = width;

		// Capture pointer for reliable tracking even outside the element
		(e.target as HTMLElement).setPointerCapture(e.pointerId);
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';
	}

	function handlePointerMove(e: PointerEvent): void {
		if (!dragging) return;
		const delta = e.clientX - startX;
		// For a left-side panel, moving right = wider; for right-side panel, moving left = wider
		const raw = side === 'left' ? startWidth + delta : startWidth - delta;
		const clamped = Math.max(min, Math.min(max, raw));
		onresize?.(clamped);
	}

	function handlePointerUp(): void {
		if (!dragging) return;
		dragging = false;
		document.body.style.cursor = '';
		document.body.style.userSelect = '';
	}
</script>

<div
	class="resize-handle"
	class:dragging
	class:right={side === 'right'}
	role="separator"
	aria-orientation="vertical"
	aria-valuenow={width}
	aria-valuemin={min}
	aria-valuemax={max}
	tabindex="0"
	onpointerdown={handlePointerDown}
	onpointermove={handlePointerMove}
	onpointerup={handlePointerUp}
	onpointercancel={handlePointerUp}
></div>

<style>
	.resize-handle {
		position: absolute;
		top: 0;
		right: -3px;
		width: 6px;
		height: 100%;
		cursor: col-resize;
		z-index: 10;
		/* Visible indicator on hover */
		background: transparent;
		transition: background 0.15s ease;
	}

	.resize-handle.right {
		right: auto;
		left: -3px;
	}

	.resize-handle:hover,
	.resize-handle.dragging {
		background: var(--accent-primary);
	}
</style>
