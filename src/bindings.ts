import type { D1Database, Fetcher } from '@cloudflare/workers-types';

export interface Bindings {
	DB: D1Database;
	ASSETS: Fetcher;
	ACCESS_TOKEN?: string;
}

export type AppEnv = {
	Bindings: Bindings;
};
