<script lang="ts">
	import { nickColor } from '$lib/irc/format';
	import { themeState } from '$lib/state/theme.svelte';
	import { getProfile, resolveAvatarUrl } from '$lib/state/profiles.svelte';
	import { getMember } from '$lib/state/members.svelte';
	import { getRoleColor } from '$lib/state/serverConfig.svelte';

	interface Props {
		/** Account name to look up profile/avatar. */
		account: string;
		/** Nick for fallback initial letter. */
		nick?: string;
		/** Channel for role color lookup. */
		channel?: string;
		/** Size preset: sm=24px, md=32px, lg=40px. */
		size?: 'sm' | 'md' | 'lg';
	}

	let {
		account,
		nick,
		channel,
		size = 'md',
	}: Props = $props();

	let imgError = $state(false);

	let profile = $derived(getProfile(account));
	let avatarUrl = $derived(resolveAvatarUrl(profile?.avatar));

	let showImage = $derived(!!avatarUrl && !imgError);

	let color = $derived.by(() => {
		if (channel) {
			const displayNick = nick ?? account;
			const member = getMember(channel, displayNick);
			if (member?.highestMode) {
				const roleColor = getRoleColor(member.highestMode);
				if (roleColor) return roleColor;
			}
		}
		return nickColor(account, themeState.current);
	});

	let initial = $derived((nick ?? account).charAt(0).toUpperCase());

	let sizePx = $derived(size === 'sm' ? 24 : size === 'lg' ? 40 : 32);

	function handleImgError() {
		imgError = true;
	}

	// Reset error state when account changes
	$effect(() => {
		void account;
		imgError = false;
	});
</script>

{#if showImage}
	<img
		class="avatar-img avatar-{size}"
		src={avatarUrl}
		alt="{nick ?? account}'s avatar"
		width={sizePx}
		height={sizePx}
		loading="lazy"
		onerror={handleImgError}
	/>
{:else}
	<div
		class="avatar-circle avatar-{size}"
		style="background-color: {color}; width: {sizePx}px; height: {sizePx}px;"
	>
		{initial}
	</div>
{/if}

<style>
	.avatar-img {
		border-radius: 50%;
		object-fit: cover;
		flex-shrink: 0;
	}

	.avatar-circle {
		border-radius: 50%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-weight: var(--weight-semibold);
		color: var(--text-inverse);
		flex-shrink: 0;
	}

	.avatar-sm {
		font-size: 11px;
	}

	.avatar-md {
		font-size: var(--font-sm);
	}

	.avatar-lg {
		font-size: var(--font-md);
	}
</style>
