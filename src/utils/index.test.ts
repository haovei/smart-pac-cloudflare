import { describe, it, expect } from 'vitest';
import { hostMatch, findProxyForURL, generatePac } from '../utils';
import type { HostConfig } from '../types';

const hostConfig: HostConfig = {
	hosts: [
		{ id: 1, host: 'proxy.example.com', port: 8080, type: 'SOCKS' },
		{ id: 2, host: 'proxy2.example.com', port: 8081, type: 'HTTP' },
	],
	rules: [
		['*.google.com', [1]],
		['*.github.com', [1, 2]],
		['a.youtube.com', [2]],
	],
};

describe('hostMatch', () => {
	it('当主机与没有通配符的规则匹配', () => {
		const host = 'example.com';
		const rule = 'example.com';

		const result = hostMatch(host, rule);

		expect(result).toBe(true);
	});

	it('根域名的匹配', () => {
		const host = 'example.com';
		const rule = '*.example.com';

		const result = hostMatch(host, rule);

		expect(result).toBe(true);
	});

	it('当主机与带有通配符的规则匹配', () => {
		const host = 'sub.example.com';
		const rule = '*.example.com';

		const result = hostMatch(host, rule);

		expect(result).toBe(true);
	});

	it('当主机与没有通配符的规则不匹配', () => {
		const host = 'example.com';
		const rule = 'example.org';

		const result = hostMatch(host, rule);

		expect(result).toBe(false);
	});

	it('当主机与带有通配符的规则不匹配', () => {
		const host = 'sub.example.com';
		const rule = '*.example.org';

		const result = hostMatch(host, rule);

		expect(result).toBe(false);
	});

	it('绝对域名不匹配', () => {
		const host = 'a.example.com';
		const rule = 'example.com';

		const result = hostMatch(host, rule);

		expect(result).toBe(false);
	});
});

describe('findProxyForURL', () => {
	it('当没有匹配规则时，返回 "DIRECT"', () => {
		const result = findProxyForURL(hostConfig, 'https://example.com', 'example.com');
		expect(result).toBe('DIRECT');
	});

	it('匹配单个代理', () => {
		const result = findProxyForURL(hostConfig, 'https://www.google.com', 'www.google.com');
		expect(result).toBe('SOCKS proxy.example.com:8080;DIRECT');
	});

	it('匹配多个代理', () => {
		const result = findProxyForURL(hostConfig, 'https://www.github.com', 'www.github.com');
		expect(result).toBe('SOCKS proxy.example.com:8080;HTTP proxy2.example.com:8081;DIRECT');
	});
});

describe('generatePac', () => {
	it('生成的 PAC 脚本包含 FindProxyForURL 实现', () => {
		const pac = generatePac(hostConfig);
		expect(pac).toContain('function FindProxyForURL');
		expect(pac).toContain('const hostConfig');
	});
});
