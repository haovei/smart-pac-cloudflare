import { beforeEach, describe, expect, it } from 'vitest';
import {
	addOrUpdateHost,
	listHosts,
	delHost,
	listRules,
	addOrUpdateRule,
	delRule,
	getHostConfig,
} from './index';
import type { HostConfig } from '../types';
import type { Bindings } from '../bindings';

type HostRow = {
	id: number;
	name: string | null;
	host: string;
	port: number;
	type: string | null;
};

type RuleRow = {
	rule: string;
	host_ids: string;
};

type StatementResult = {
	results?: unknown[];
	success: boolean;
	changes?: number;
	meta?: {
		last_row_id?: number;
		changes?: number;
	};
};

class MemoryStatement {
	private params: unknown[] = [];

	constructor(private readonly db: MemoryDatabase, private readonly query: string) {}

	bind(...values: unknown[]) {
		this.params = values;
		return this;
	}

	async first<T>(column?: string): Promise<T | null> {
		const result = await this.all();
		const [head] = result.results ?? [];
		if (!head) {
			return null;
		}
		if (column) {
			return ((head as Record<string, unknown>)[column] as T | undefined) ?? null;
		}
		return head as T;
	}

	async all(): Promise<StatementResult> {
		if (this.query.startsWith('SELECT id, name, host, port, type FROM hosts')) {
			const results = [...this.db.hosts]
				.sort((a, b) => a.id - b.id)
				.map((host) => ({ ...host }));
			return { success: true, results };
		}
		if (this.query.startsWith('SELECT rule, host_ids FROM rules')) {
			const results = this.db.rules.map((rule) => ({ ...rule }));
			return { success: true, results };
		}
		throw new Error(`Unsupported query for all(): ${this.query}`);
	}

	async run(): Promise<StatementResult> {
		if (this.query.startsWith('INSERT INTO hosts')) {
			const [name, host, port, type] = this.params as [string | null, string, number, string];
			const id = this.db.nextHostId();
			this.db.hosts.push({ id, name, host, port: Number(port), type });
			return { success: true, meta: { last_row_id: id, changes: 1 } };
		}
		if (this.query.startsWith('UPDATE hosts')) {
			const [name, host, port, type, id] = this.params as [string | null, string, number, string, number];
			const target = this.db.hosts.find((item) => item.id === Number(id));
			if (target) {
				target.name = name;
				target.host = host;
				target.port = Number(port);
				target.type = type;
			}
			return { success: true, meta: { changes: target ? 1 : 0 } };
		}
		if (this.query.startsWith('DELETE FROM hosts')) {
			const [id] = this.params as [number];
			const before = this.db.hosts.length;
			this.db.hosts = this.db.hosts.filter((item) => item.id !== Number(id));
			return { success: true, meta: { changes: before - this.db.hosts.length } };
		}
		if (this.query.startsWith('UPDATE rules SET host_ids')) {
			const [hostIds, ruleName] = this.params as [string, string];
			const target = this.db.rules.find((item) => item.rule === ruleName);
			if (target) {
				target.host_ids = hostIds;
			}
			return { success: true, meta: { changes: target ? 1 : 0 } };
		}
		if (this.query.startsWith('INSERT INTO rules')) {
			const [ruleName, hostIds] = this.params as [string, string];
			const existing = this.db.rules.find((item) => item.rule === ruleName);
			if (existing) {
				existing.host_ids = hostIds;
			} else {
				this.db.rules.push({ rule: ruleName, host_ids: hostIds });
			}
			return { success: true, meta: { changes: 1 } };
		}
		if (this.query.startsWith('DELETE FROM rules')) {
			const [ruleName] = this.params as [string];
			const before = this.db.rules.length;
			this.db.rules = this.db.rules.filter((item) => item.rule !== ruleName);
			return { success: true, meta: { changes: before - this.db.rules.length } };
		}
		throw new Error(`Unsupported query for run(): ${this.query}`);
	}
}

class MemoryDatabase {
	hosts: HostRow[] = [];
	rules: RuleRow[] = [];
	private hostAutoIncrement = 0;

	prepare(query: string): MemoryStatement {
		return new MemoryStatement(this, query);
	}

	async batch(statements: MemoryStatement[]): Promise<StatementResult[]> {
		const results: StatementResult[] = [];
		for (const statement of statements) {
			results.push(await statement.run());
		}
		return results;
	}

	nextHostId(): number {
		this.hostAutoIncrement = Math.max(this.hostAutoIncrement + 1, 1);
		return this.hostAutoIncrement;
	}

	seed(config: HostConfig) {
		this.hosts = config.hosts.map((host) => ({
			id: host.id,
			name: host.name ?? null,
			host: host.host,
			port: host.port,
			type: host.type ?? 'PROXY',
		}));
		this.rules = config.rules.map(([rule, hostIds]) => ({
			rule,
			host_ids: JSON.stringify(hostIds),
		}));
		this.hostAutoIncrement = this.hosts.reduce((max, host) => Math.max(max, host.id), 0);
	}
}

const createMemoryDb = (config?: HostConfig) => {
	const db = new MemoryDatabase();
	if (config) {
		db.seed(config);
	}
	return db;
};

describe('Cloudflare D1 adapter', () => {
	let db: MemoryDatabase;

	beforeEach(() => {
		db = createMemoryDb({
			hosts: [
				{ id: 1, host: 'example.com', port: 8080, type: 'HTTP' },
				{ id: 2, host: 'example.org', port: 8081, type: 'SOCKS' },
			],
			rules: [
				['*.example.com', [1]],
				['*.example.org', [2]],
			],
		});
	});

	it('listHosts 返回数据库中的 host 列表', async () => {
		const hosts = await listHosts(db as unknown as Bindings['DB']);
		expect(hosts).toHaveLength(2);
		expect(hosts[0].host).toBe('example.com');
	});

	it('addOrUpdateHost 可以新增 host', async () => {
		const id = await addOrUpdateHost(db as unknown as Bindings['DB'], {
			host: 'example.net',
			port: 9000,
			type: 'HTTP',
		});
		expect(id).toBe(3);
		const hosts = await listHosts(db as unknown as Bindings['DB']);
		expect(hosts.some((item) => item.id === id && item.host === 'example.net')).toBe(true);
	});

	it('addOrUpdateHost 可以更新现有 host', async () => {
		await addOrUpdateHost(db as unknown as Bindings['DB'], {
			id: 2,
			host: 'example.org',
			port: 9090,
			type: 'SOCKS5',
		});
		const hosts = await listHosts(db as unknown as Bindings['DB']);
		const updated = hosts.find((item) => item.id === 2);
		expect(updated?.port).toBe(9090);
		expect(updated?.type).toBe('SOCKS5');
	});

	it('delHost 会删除 host 并更新规则', async () => {
		await delHost(db as unknown as Bindings['DB'], 1);
		const hosts = await listHosts(db as unknown as Bindings['DB']);
		expect(hosts.find((item) => item.id === 1)).toBeUndefined();
		const rules = await listRules(db as unknown as Bindings['DB']);
		const updatedRule = rules.find(([rule]) => rule === '*.example.com');
		expect(updatedRule?.[1]).toEqual([]);
	});

	it('listRules 返回规则列表', async () => {
		const rules = await listRules(db as unknown as Bindings['DB']);
		expect(rules).toHaveLength(2);
		expect(rules[0][0]).toBe('*.example.com');
	});

	it('addOrUpdateRule 会 upsert 规则', async () => {
		await addOrUpdateRule(db as unknown as Bindings['DB'], ['*.example.com', [1, 2]]);
		const rules = await listRules(db as unknown as Bindings['DB']);
		const updated = rules.find(([rule]) => rule === '*.example.com');
		expect(updated?.[1]).toEqual([1, 2]);
	});

	it('delRule 会删除规则', async () => {
		await delRule(db as unknown as Bindings['DB'], '*.example.org');
		const rules = await listRules(db as unknown as Bindings['DB']);
		expect(rules.find(([rule]) => rule === '*.example.org')).toBeUndefined();
	});

	it('getHostConfig 返回完整配置', async () => {
		const config = await getHostConfig(db as unknown as Bindings['DB']);
		expect(config.hosts).toHaveLength(2);
		expect(config.rules).toHaveLength(2);
	});
});