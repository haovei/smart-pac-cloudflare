import type { Host, HostConfig } from '../types';

// host 通配符匹配
export function hostMatch(host: string, rule: string): boolean {
	if (rule.startsWith('*.')) {
		return host.endsWith(rule.slice(2));
	}
	return host === rule;
}

function resolveHostsByRule(hostConfig: HostConfig, host: string): Host[] {
	const { hosts, rules } = hostConfig;
	const hostRule = rules.find((item) => hostMatch(host, item[0]));
	if (!hostRule) {
		return [];
	}
	return hostRule[1]
		.map((hostId) => hosts.find((item) => item.id === hostId))
		.filter((item): item is Host => Boolean(item));
}

export function findProxyForURL(hostConfig: HostConfig, _url: string, host: string) {
	const matchedHosts = resolveHostsByRule(hostConfig, host);
	const proxies = matchedHosts.map((item) => `${item.type || 'PROXY'} ${item.host}:${item.port}`);
	proxies.push('DIRECT');
	return proxies.join(';');
}

// 生成 PAC 文件
export function generatePac(hostConfig: HostConfig) {
	const stringList: string[] = [];
	stringList.push(`const hostConfig=${JSON.stringify(hostConfig)}`);
	stringList.push(`${hostMatch.toString()};`);
	stringList.push(`${findProxyForURL.toString()};`);
	stringList.push('function FindProxyForURL(url, host) {');
	stringList.push('	return findProxyForURL(hostConfig, url, host);');
	stringList.push('}');
	return stringList.join('\n');
}
