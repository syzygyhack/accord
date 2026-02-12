import { redirect } from '@sveltejs/kit';
import { isAuthenticated } from '$lib/api/auth';
import type { PageLoad } from './$types';

/**
 * Login page load function.
 * If the user is already authenticated (has stored credentials),
 * redirect straight to /chat — no need to log in again.
 */
export const load: PageLoad = () => {
	if (isAuthenticated()) {
		redirect(302, '/chat');
	}
};
