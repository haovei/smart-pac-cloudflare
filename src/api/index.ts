import type { Bindings } from '../bindings';
import type { Host, HostConfig, Rule } from '../types';

type Database = Bindings['DB'];

const DEFAULT_PROXY_TYPE = 'PROXY';

type HostInput = {
	id?: number;
	name?: string;
	host: string;
	port: number;
	type?: string;
};

type HostRow = {
	id: number;
	name: string | null;
	host: string;
	port: number;
	type: string | null;
};

type RuleRow = {
	rule: string;
	host_ids: string | null;
};

const sanitizeProxyType = (type?: string | null) => (type && type.trim().length > 0 ? type : DEFAULT_PROXY_TYPE);

const normalizeHost = (row: HostRow): Host => ({
	id: row.id,
	name: row.name ?? undefined,
	host: row.host,
	port: row.port,
	type: sanitizeProxyType(row.type),
});

const normalizeRule = (row: RuleRow): Rule => [row.rule, parseHostIds(row.host_ids)];

const parseHostIds = (ids: string | null): number[] => {
	if (!ids) {
		return [];
	}
	try {
		const parsed = JSON.parse(ids);
		if (!Array.isArray(parsed)) {
			return [];
		}
		const sanitized = parsed
			.map((item) => Number(item))
			.filter((item) => Number.isInteger(item) && item > 0);
		return Array.from(new Set(sanitized));
	} catch (error) {
		console.error('Failed to parse host_ids', ids, error);
		return [];
	}
};

const encodeHostIds = (ids: number[]) => JSON.stringify(Array.from(new Set(ids.filter((item) => Number.isInteger(item) && item > 0))));

export const listHosts = async (db: Database): Promise<Host[]> => {
	const result = await db.prepare('SELECT id, name, host, port, type FROM hosts ORDER BY id').all<HostRow>();
	return (result.results ?? []).map(normalizeHost);
};

export const listRules = async (db: Database): Promise<Rule[]> => {
	const result = await db.prepare('SELECT rule, host_ids FROM rules ORDER BY rowid').all<RuleRow>();
	return (result.results ?? []).map(normalizeRule);
};

export const getHostConfig = async (db: Database): Promise<HostConfig> => {
	const [hosts, rules] = await Promise.all([listHosts(db), listRules(db)]);
	return {
		hosts,
		rules,
	};
};

export const addOrUpdateHost = async (db: Database, host: HostInput): Promise<number> => {
	const proxyType = sanitizeProxyType(host.type);
	if (host.id) {
		await db
			.prepare('UPDATE hosts SET name = ?, host = ?, port = ?, type = ? WHERE id = ?')
			.bind(host.name ?? null, host.host, host.port, proxyType, host.id)
			.run();
		return host.id;
	}
	const result = await db
		.prepare('INSERT INTO hosts (name, host, port, type) VALUES (?, ?, ?, ?)')
		.bind(host.name ?? null, host.host, host.port, proxyType)
		.run();
	const legacyLastRowId = (result as { lastRowId?: number }).lastRowId;
	const newId = typeof legacyLastRowId === 'number' ? legacyLastRowId : result.meta?.last_row_id;
	if (typeof newId !== 'number') {
		throw new Error('Failed to insert host');
	}
	return newId;
};

export const delHost = async (db: Database, id: number): Promise<void> => {
	await db.prepare('DELETE FROM hosts WHERE id = ?').bind(id).run();
	const rules = await listRules(db);
	const updates = rules
		.map(([ruleName, hostIds]) => {
			const filtered = hostIds.filter((hostId) => hostId !== id);
			if (filtered.length === hostIds.length) {
				return null;
			}
			return db
				.prepare('UPDATE rules SET host_ids = ? WHERE rule = ?')
				.bind(encodeHostIds(filtered), ruleName);
		})
		.filter((statement): statement is ReturnType<Database['prepare']> => Boolean(statement));
	if (updates.length > 0) {
		await db.batch(updates);
	}
};

export const addOrUpdateRule = async (db: Database, rule: Rule): Promise<void> => {
	const [ruleName, hostIds] = rule;
	await db
		.prepare(
			'INSERT INTO rules (rule, host_ids) VALUES (?, ?) ON CONFLICT(rule) DO UPDATE SET host_ids = excluded.host_ids'
		)
		.bind(ruleName, encodeHostIds(hostIds))
		.run();
};

export const delRule = async (db: Database, ruleName: string): Promise<void> => {
	await db.prepare('DELETE FROM rules WHERE rule = ?').bind(ruleName).run();
};
