<script lang="ts" module>
	/**
	 * Auth level for slash commands:
	 *   'user' — available to everyone
	 *   'mod'  — requires halfop (%) or above in the channel
	 */
	export type CommandLevel = 'user' | 'mod';

	export interface CommandDef {
		name: string;
		usage: string;
		description: string;
		level: CommandLevel;
	}

	export const SLASH_COMMANDS: CommandDef[] = [
		{ name: 'join', usage: '/join #channel', description: 'Join a channel', level: 'user' },
		{ name: 'me', usage: '/me <action>', description: 'Send an action message', level: 'user' },
		{ name: 'msg', usage: '/msg <user> <message>', description: 'Send a direct message', level: 'user' },
		{ name: 'nick', usage: '/nick <name>', description: 'Change your display name', level: 'user' },
		{ name: 'part', usage: '/part [channel] [reason]', description: 'Leave a channel', level: 'user' },
		{ name: 'topic', usage: '/topic [new topic]', description: 'View or set channel topic', level: 'user' },
		{ name: 'invite', usage: '/invite <user> [channel]', description: 'Invite a user to a channel', level: 'user' },
		{ name: 'whois', usage: '/whois <user>', description: 'Show user information', level: 'user' },
		{ name: 'kick', usage: '/kick <user> [reason]', description: 'Kick a user from the channel', level: 'mod' },
		{ name: 'mute', usage: '/mute <user>', description: 'Mute a user in the channel', level: 'mod' },
		{ name: 'ban', usage: '/ban <user>', description: 'Ban a user from the channel', level: 'mod' },
		{ name: 'unban', usage: '/unban <user>', description: 'Remove a ban on a user', level: 'mod' },
		{ name: 'mode', usage: '/mode <target> <modes>', description: 'Set channel or user modes', level: 'mod' },
	];

	/** Mode prefixes that qualify as "mod" level (halfop and above). */
	const MOD_MODES = ['~', '&', '@', '%'];

	/**
	 * Check if a user's highest channel mode meets the required command level.
	 * @param highestMode The user's highest mode prefix in the channel, or null.
	 * @param level The required command level.
	 */
	export function hasCommandAccess(highestMode: string | null, level: CommandLevel): boolean {
		if (level === 'user') return true;
		if (!highestMode) return false;
		return MOD_MODES.includes(highestMode);
	}

	/**
	 * Filter commands by text filter and user privilege level.
	 * @param filter Text prefix to match command names against.
	 * @param highestMode The user's highest mode prefix in the current channel.
	 */
	export function filterCommands(filter: string, highestMode: string | null = null): CommandDef[] {
		let cmds = SLASH_COMMANDS.filter(c => hasCommandAccess(highestMode, c.level));
		if (filter) {
			cmds = cmds.filter(c => c.name.startsWith(filter.toLowerCase()));
		}
		return cmds;
	}
</script>

<script lang="ts">
	interface Props {
		commands: CommandDef[];
		selectedIndex: number;
		onselect: (command: CommandDef) => void;
		onhover: (index: number) => void;
	}

	let { commands, selectedIndex, onselect, onhover }: Props = $props();

	let listEl: HTMLDivElement | undefined = $state();

	// Auto-scroll selected item into view
	$effect(() => {
		void selectedIndex;
		requestAnimationFrame(() => {
			const el = listEl?.querySelector('.selected');
			el?.scrollIntoView({ block: 'nearest' });
		});
	});
</script>

{#if commands.length > 0}
	<div class="slash-menu" bind:this={listEl}>
		{#each commands as cmd, i (cmd.name)}
			<button
				class="slash-item"
				class:selected={i === selectedIndex}
				onmousedown={(e) => { e.preventDefault(); onselect(cmd); }}
				onmouseenter={() => onhover(i)}
			>
				<span class="cmd-name">/{cmd.name}</span>
				<span class="cmd-desc">{cmd.description}</span>
				{#if cmd.level === 'mod'}
					<span class="cmd-badge">MOD</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}

<style>
	.slash-menu {
		position: absolute;
		bottom: 100%;
		left: 0;
		right: 0;
		max-height: 280px;
		overflow-y: auto;
		background: var(--surface-high);
		border-radius: 8px 8px 0 0;
		border: 1px solid var(--surface-highest);
		border-bottom: none;
		display: flex;
		flex-direction: column;
		z-index: 100;
		padding: 4px 0;
		box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.2);
	}

	.slash-item {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 8px 14px;
		background: none;
		border: none;
		cursor: pointer;
		text-align: left;
		color: var(--text-primary);
		font-family: var(--font-primary);
		font-size: var(--font-base);
		transition: background 0.06s ease;
	}

	.slash-item.selected {
		background: var(--accent-bg);
	}

	.slash-item:hover {
		background: var(--accent-bg);
	}

	.cmd-name {
		font-weight: var(--weight-semibold);
		font-family: var(--font-mono);
		font-size: var(--font-sm);
		color: var(--accent-primary);
		min-width: 80px;
		flex-shrink: 0;
	}

	.cmd-desc {
		color: var(--text-secondary);
		font-size: var(--font-sm);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		flex: 1;
		min-width: 0;
	}

	.cmd-badge {
		font-size: 9px;
		font-weight: var(--weight-bold);
		letter-spacing: 0.05em;
		color: var(--warning, #f0b232);
		background: var(--warning-bg);
		padding: 1px 5px;
		border-radius: 3px;
		flex-shrink: 0;
	}
</style>
