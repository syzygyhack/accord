<script lang="ts">
	interface Props {
		onconfirm: () => void;
		oncancel: () => void;
	}

	let { onconfirm, oncancel }: Props = $props();
</script>

<div class="delete-overlay" role="dialog" aria-modal="true" aria-labelledby="delete-dialog-title" tabindex="-1" onclick={oncancel} onkeydown={(e) => { if (e.key === 'Escape') oncancel(); }}>
	<div class="delete-dialog" role="presentation" onclick={(e) => e.stopPropagation()}>
		<h3 id="delete-dialog-title" class="delete-title">Delete Message</h3>
		<p class="delete-text">Are you sure you want to delete this message? This cannot be undone.</p>
		<div class="delete-actions">
			<button class="btn-cancel" onclick={oncancel}>Cancel</button>
			<button class="btn-delete" onclick={onconfirm}>Delete</button>
		</div>
	</div>
</div>

<style>
	.delete-overlay {
		position: fixed;
		inset: 0;
		z-index: 1100;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
	}

	.delete-dialog {
		background: var(--surface-low);
		border-radius: 8px;
		padding: 24px;
		max-width: 400px;
		width: 90%;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
	}

	.delete-title {
		margin: 0 0 8px;
		font-size: var(--font-md);
		font-weight: var(--weight-semibold);
		color: var(--text-primary);
	}

	.delete-text {
		margin: 0 0 20px;
		font-size: var(--font-base);
		color: var(--text-secondary);
		line-height: 1.5;
	}

	.delete-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	.btn-cancel {
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: var(--surface-high);
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.btn-cancel:hover {
		background: var(--surface-highest);
	}

	.btn-delete {
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		background: var(--danger);
		color: var(--text-inverse);
		font-family: var(--font-primary);
		font-size: var(--font-sm);
		font-weight: var(--weight-medium);
		cursor: pointer;
	}

	.btn-delete:hover {
		filter: brightness(1.1);
	}
</style>
