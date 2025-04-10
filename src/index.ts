import { Hono } from 'hono';
import { cors } from 'hono/cors';

// 定义类型
interface User {
    id?: number;
    name: string;
    token: string;
    created_at?: number;
}

interface Host {
    id?: number;
    user_id: number;
    name: string;
    type: 'SOCKS' | 'HTTP' | 'HTTPS';
    host: string;
    port: number;
}

interface Rule {
    id?: number;
    user_id: number;
    pattern: string;
    host_ids: number[];
}

// 创建应用
const app = new Hono();

// 使用CORS中间件
app.use('/*', cors());

// 首页
app.get('/', (c) => {
    return c.text('Smart PAC API is running!');
});

// 验证中间件
async function authMiddleware(c: any, next: () => Promise<any>) {
    try {
        const token = c.req.header('Authorization')?.replace('Bearer ', '') || c.req.query('token');

        if (!token) {
            return c.json({ success: false, error: '未提供认证令牌' }, 401);
        }

        const { DB } = c.env;
        const { results } = await DB.prepare('SELECT * FROM users WHERE token = ?').bind(token).all();

        if (results.length === 0) {
            return c.json({ success: false, error: '无效的令牌' }, 401);
        }

        // 将用户保存到上下文中
        c.set('user', results[0]);
        return next();
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: '认证失败' }, 500);
    }
}

// API路由
const api = new Hono();

// 用户相关API
api.get('/user', authMiddleware, async (c) => {
    const user = c.get('user');
    return c.json({ success: true, data: user });
});

api.post('/register', async (c) => {
    try {
        const { DB } = c.env;
        const userData: User = await c.req.json();

        if (!userData.name || !userData.token) {
            return c.json({ success: false, error: '缺少必要字段' }, 400);
        }

        // 检查token是否已存在
        const { results } = await DB.prepare('SELECT id FROM users WHERE token = ?').bind(userData.token).all();
        if (results.length > 0) {
            return c.json({ success: false, error: '该令牌已被使用' }, 400);
        }

        // 创建新用户
        const result = await DB.prepare('INSERT INTO users (name, token) VALUES (?, ?)')
            .bind(userData.name, userData.token)
            .run();

        // 获取新创建的用户ID
        const { results: newUser } = await DB.prepare('SELECT * FROM users WHERE token = ?').bind(userData.token).all();

        return c.json({ success: true, data: newUser[0] });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

api.post('/updateUser', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const currentUser = c.get('user');
        const userData: User = await c.req.json();

        if (!userData.name && !userData.token) {
            return c.json({ success: false, error: '至少需要提供一个更新字段' }, 400);
        }

        // 检查token是否已被其他用户使用
        if (userData.token) {
            const { results } = await DB.prepare('SELECT id FROM users WHERE token = ? AND id != ?')
                .bind(userData.token, currentUser.id)
                .all();
            if (results.length > 0) {
                return c.json({ success: false, error: '该令牌已被使用' }, 400);
            }
        }

        // 更新用户
        let query = 'UPDATE users SET ';
        const values = [];

        if (userData.name) {
            query += 'name = ?, ';
            values.push(userData.name);
        }

        if (userData.token) {
            query += 'token = ?, ';
            values.push(userData.token);
        }

        // 移除最后的逗号和空格
        query = query.slice(0, -2);
        query += ' WHERE id = ?';
        values.push(currentUser.id);

        const result = await DB.prepare(query)
            .bind(...values)
            .run();

        // 获取更新后的用户信息
        const { results: updatedUser } = await DB.prepare('SELECT * FROM users WHERE id = ?')
            .bind(currentUser.id)
            .all();

        return c.json({ success: true, data: updatedUser[0] });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

// 主机相关API
api.get('/hostList', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const user = c.get('user');

        const { results } = await DB.prepare('SELECT * FROM hosts WHERE user_id = ? ORDER BY id').bind(user.id).all();

        return c.json({ success: true, data: results });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

api.post('/updateHost', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const user = c.get('user');
        const host: Host = await c.req.json();

        if (!host.name || !host.type || !host.host || !host.port) {
            return c.json({ success: false, error: '缺少必要字段' }, 400);
        }

        let result;

        if (host.id) {
            // 确认主机属于当前用户
            const { results } = await DB.prepare('SELECT id FROM hosts WHERE id = ? AND user_id = ?')
                .bind(host.id, user.id)
                .all();

            if (results.length === 0) {
                return c.json({ success: false, error: '未找到指定主机或无权限修改' }, 404);
            }

            // 更新已有主机
            result = await DB.prepare(
                'UPDATE hosts SET name = ?, type = ?, host = ?, port = ? WHERE id = ? AND user_id = ?'
            )
                .bind(host.name, host.type, host.host, host.port, host.id, user.id)
                .run();
        } else {
            // 创建新主机
            result = await DB.prepare('INSERT INTO hosts (user_id, name, type, host, port) VALUES (?, ?, ?, ?, ?)')
                .bind(user.id, host.name, host.type, host.host, host.port)
                .run();
        }

        return c.json({ success: true, data: result });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

api.delete('/deleteHost', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const user = c.get('user');
        const { id } = await c.req.json();

        if (!id) {
            return c.json({ success: false, error: '缺少主机ID' }, 400);
        }

        // 确认主机属于当前用户
        const { results: hostResults } = await DB.prepare('SELECT id FROM hosts WHERE id = ? AND user_id = ?')
            .bind(id, user.id)
            .all();

        if (hostResults.length === 0) {
            return c.json({ success: false, error: '未找到指定主机或无权限删除' }, 404);
        }

        // 首先检查是否有规则使用此主机
        const { results: rules } = await DB.prepare('SELECT * FROM rules WHERE user_id = ?').bind(user.id).all();

        for (const rule of rules) {
            const hostIds = JSON.parse(rule.host_ids);
            if (hostIds.includes(Number(id))) {
                return c.json(
                    {
                        success: false,
                        error: `主机ID ${id} 仍在规则 "${rule.pattern}" 中使用，无法删除`,
                    },
                    400
                );
            }
        }

        const result = await DB.prepare('DELETE FROM hosts WHERE id = ? AND user_id = ?').bind(id, user.id).run();

        return c.json({ success: true, data: { id } });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

// 规则相关API
api.get('/ruleList', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const user = c.get('user');

        const { results } = await DB.prepare('SELECT * FROM rules WHERE user_id = ? ORDER BY pattern')
            .bind(user.id)
            .all();

        // 转换host_ids从字符串到数组
        const data = results.map((rule: any) => ({
            ...rule,
            host_ids: JSON.parse(rule.host_ids),
        }));

        return c.json({ success: true, data });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

api.post('/updateRule', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const user = c.get('user');
        const rule: Rule = await c.req.json();

        if (!rule.pattern || !Array.isArray(rule.host_ids)) {
            return c.json({ success: false, error: '缺少必要字段或格式错误' }, 400);
        }

        // 验证所有主机ID是否存在且属于当前用户
        for (const hostId of rule.host_ids) {
            const { results } = await DB.prepare('SELECT id FROM hosts WHERE id = ? AND user_id = ?')
                .bind(hostId, user.id)
                .all();

            if (results.length === 0) {
                return c.json(
                    {
                        success: false,
                        error: `主机ID ${hostId} 不存在或不属于当前用户`,
                    },
                    400
                );
            }
        }

        // 将主机ID数组转换为JSON字符串
        const hostIdsJson = JSON.stringify(rule.host_ids);
        let result;

        if (rule.id) {
            // 确认规则属于当前用户
            const { results } = await DB.prepare('SELECT id FROM rules WHERE id = ? AND user_id = ?')
                .bind(rule.id, user.id)
                .all();

            if (results.length === 0) {
                return c.json({ success: false, error: '未找到指定规则或无权限修改' }, 404);
            }

            // 更新现有规则
            result = await DB.prepare('UPDATE rules SET pattern = ?, host_ids = ? WHERE id = ? AND user_id = ?')
                .bind(rule.pattern, hostIdsJson, rule.id, user.id)
                .run();
        } else {
            // 检查规则是否存在于当前用户下
            const { results } = await DB.prepare('SELECT id FROM rules WHERE pattern = ? AND user_id = ?')
                .bind(rule.pattern, user.id)
                .all();

            if (results.length > 0) {
                // 如果规则存在，则更新它
                result = await DB.prepare('UPDATE rules SET host_ids = ? WHERE pattern = ? AND user_id = ?')
                    .bind(hostIdsJson, rule.pattern, user.id)
                    .run();
            } else {
                // 否则创建新规则
                result = await DB.prepare('INSERT INTO rules (user_id, pattern, host_ids) VALUES (?, ?, ?)')
                    .bind(user.id, rule.pattern, hostIdsJson)
                    .run();
            }
        }

        return c.json({ success: true, data: { pattern: rule.pattern, host_ids: rule.host_ids } });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

api.delete('/deleteRule', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const user = c.get('user');
        const data = await c.req.json();

        if (!data.id && !data.pattern) {
            return c.json({ success: false, error: '缺少规则ID或规则模式' }, 400);
        }

        let result;

        if (data.id) {
            // 确认规则属于当前用户
            const { results } = await DB.prepare('SELECT id FROM rules WHERE id = ? AND user_id = ?')
                .bind(data.id, user.id)
                .all();

            if (results.length === 0) {
                return c.json({ success: false, error: '未找到指定规则或无权限删除' }, 404);
            }

            result = await DB.prepare('DELETE FROM rules WHERE id = ? AND user_id = ?').bind(data.id, user.id).run();
        } else if (data.pattern) {
            // 确认规则属于当前用户
            const { results } = await DB.prepare('SELECT id FROM rules WHERE pattern = ? AND user_id = ?')
                .bind(data.pattern, user.id)
                .all();

            if (results.length === 0) {
                return c.json({ success: false, error: '未找到指定规则或无权限删除' }, 404);
            }

            result = await DB.prepare('DELETE FROM rules WHERE pattern = ? AND user_id = ?')
                .bind(data.pattern, user.id)
                .run();
        }

        return c.json({ success: true, data: data.id ? { id: data.id } : { pattern: data.pattern } });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

// 导出配置API
api.get('/exportConfig', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const user = c.get('user');

        // 获取当前用户的所有主机
        const { results: hosts } = await DB.prepare('SELECT * FROM hosts WHERE user_id = ? ORDER BY id')
            .bind(user.id)
            .all();

        // 获取当前用户的所有规则
        const { results: rulesRaw } = await DB.prepare(
            'SELECT pattern, host_ids FROM rules WHERE user_id = ? ORDER BY pattern'
        )
            .bind(user.id)
            .all();

        // 转换规则格式
        const rules = rulesRaw.map((rule: any) => [rule.pattern, JSON.parse(rule.host_ids)]);

        // 构建配置
        const config = {
            hosts,
            rules,
        };

        return c.json(config);
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

// 生成PAC文件
api.get('/pac', authMiddleware, async (c) => {
    try {
        const { DB } = c.env;
        const user = c.get('user');

        // 获取当前用户的所有主机
        const { results: hosts } = await DB.prepare('SELECT * FROM hosts WHERE user_id = ? ORDER BY id')
            .bind(user.id)
            .all();

        // 获取当前用户的所有规则
        const { results: rules } = await DB.prepare(
            'SELECT pattern, host_ids FROM rules WHERE user_id = ? ORDER BY pattern'
        )
            .bind(user.id)
            .all();

        // 构建PAC文件内容
        let pacContent = `
function FindProxyForURL(url, host) {
    // 默认直连
    var DEFAULT = "DIRECT";
    
    // 定义代理服务器
    var PROXY = {
`;

        // 添加代理定义
        hosts.forEach((host: Host) => {
            if (host.type === 'SOCKS') {
                pacContent += `        ${host.id}: "SOCKS5 ${host.host}:${host.port}",\n`;
            } else if (host.type === 'HTTP') {
                pacContent += `        ${host.id}: "PROXY ${host.host}:${host.port}",\n`;
            } else if (host.type === 'HTTPS') {
                pacContent += `        ${host.id}: "HTTPS ${host.host}:${host.port}",\n`;
            }
        });

        pacContent += `    };
    
    // 匹配规则
`;

        // 添加规则匹配
        rules.forEach((rule: any) => {
            const pattern = rule.pattern.replace(/\*/g, '.*').replace(/\./g, '\\.');
            const hostIds = JSON.parse(rule.host_ids);

            if (hostIds.length > 0) {
                pacContent += `    if (/${pattern}/.test(host)) return PROXY[${hostIds[0]}];\n`;
            }
        });

        pacContent += `
    // 默认返回直连
    return DEFAULT;
}`;

        return new Response(pacContent, {
            headers: {
                'Content-Type': 'application/x-javascript',
                'Content-Disposition': 'attachment; filename="proxy.pac"',
            },
        });
    } catch (error) {
        console.error(error);
        return c.json({ success: false, error: error.message }, 500);
    }
});

app.route('/api', api);

export default app;
