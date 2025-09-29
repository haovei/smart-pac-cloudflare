import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { cors } from 'hono/cors';
import { generatePac } from './utils';
import logger from './utils/logger';
import {
    listHosts,
    listRules,
    addOrUpdateHost,
    delHost,
    addOrUpdateRule,
    delRule,
    getHostConfig,
} from './api';
import type { AppEnv } from './bindings';

const app = new Hono<AppEnv>();

app.use('*', async (c, next) => {
    logger.info(`${c.req.method} ${c.req.path}`);
    await next();
});

app.use('/api/*', cors());

app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname.startsWith('/api') || url.pathname === '/auto.pac') {
        await next();
        return;
    }
    const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
    if (assetResponse.status === 404) {
        await next();
        return;
    }
    return assetResponse;
});

app.get('/auto.pac', async (c) => {
    const config = await getHostConfig(c.env.DB);
    c.header('Content-Type', 'application/x-ns-proxy-autoconfig');
    return c.body(generatePac(config));
});

app.use('/api/*', async (c, next) => {
    const token = c.env.ACCESS_TOKEN;
    if (!token) {
        await next();
        return;
    }
    return bearerAuth({ token })(c, next);
});

app.get('/api/hostList', async (c) => {
    const hosts = await listHosts(c.env.DB);
    return c.json(hosts);
});

app.post('/api/updateHost', async (c) => {
    const body = await c.req.json();
    const id = await addOrUpdateHost(c.env.DB, body);
    return c.json({ success: true, id });
});

app.post('/api/deleteHost', async (c) => {
    const body = await c.req.json();
    await delHost(c.env.DB, body.id);
    return c.json({ success: true });
});

app.get('/api/ruleList', async (c) => {
    const rules = await listRules(c.env.DB);
    return c.json(rules);
});

app.post('/api/updateRule', async (c) => {
    const body = await c.req.json();
    await addOrUpdateRule(c.env.DB, body);
    return c.json({ success: true });
});

app.post('/api/deleteRule', async (c) => {
    const body = await c.req.json();
    await delRule(c.env.DB, body.rule);
    return c.json({ success: true });
});

export default app;
