const fileSystem = require('fs');
const readlineInterface = require('readline');
const { bootstrap } = require('global-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const fetch = require('node-fetch');
const chalk = require('chalk');

// 颜色配置
const colors = {
    success: chalk.green,
    error: chalk.red,
    info: chalk.blue,
    warning: chalk.yellow,
    highlight: chalk.cyan
};

// 代理处理函数
const createProxyAgent = (proxyUrl) => {
    if (!proxyUrl) return null;
    
    try {
        if (proxyUrl.startsWith('socks')) {
            return new SocksProxyAgent(proxyUrl);
        } else {
            return new HttpsProxyAgent(proxyUrl);
        }
    } catch (error) {
        console.error(colors.error(`代理配置错误: ${error.message}`));
        return null;
    }
};

// 动态fetch函数
const dynamicFetch = async (url, options = {}, proxyUrl = null) => {
    try {
        if (proxyUrl) {
            const agent = createProxyAgent(proxyUrl);
            if (agent) {
                options.agent = agent;
            }
        }
        
        const response = await fetch(url, options);
        return response;
    } catch (error) {
        console.error(colors.error(`请求失败: ${error.message}`));
        throw error;
    }
};

// 邮箱验证
const checkEmailValidity = (email) => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailPattern.test(email);
};

// 加载用户数据
const loadUserData = () => {
    try {
        if (!fileSystem.existsSync('user.txt')) {
            console.error(colors.error('user.txt 文件不存在'));
            return [];
        }

        const userData = fileSystem.readFileSync('user.txt', 'utf8');
        const userLines = userData.trim().split('\n');
        
        return userLines.map(line => {
            const [userEmail, userPassword, userProxy] = line.split(',').map(item => item?.trim());
            
            if (!checkEmailValidity(userEmail)) {
                console.error(colors.error(`邮箱格式不正确: ${userEmail}`));
                return null;
            }

            if (!userPassword) {
                console.error(colors.error(`密码不能为空: ${userEmail}`));
                return null;
            }

            return {
                email: userEmail,
                password: userPassword,
                proxy: userProxy && userProxy !== '' ? userProxy : null
            };
        }).filter(user => user !== null);
    } catch (error) {
        console.error(colors.error(`读取用户数据失败: ${error.message}`));
        return [];
    }
};

// 加载现有数据
const loadExistingData = () => {
    try {
        if (!fileSystem.existsSync('data.txt')) return {};
        
        const existingDataContent = fileSystem.readFileSync('data.txt', 'utf8');
        const existingDataLines = existingDataContent.trim().split('\n');
        const existingDataMap = {};
        
        existingDataLines.forEach(line => {
            const [email, token, proxy] = line.split(',').map(item => item?.trim());
            if (email && token) {
                existingDataMap[email] = { 
                    token, 
                    proxy: proxy && proxy !== '' ? proxy : null 
                };
            }
        });
        
        return existingDataMap;
    } catch (error) {
        console.error(colors.error(`读取现有数据失败: ${error.message}`));
        return {};
    }
};

// 保存数据
const persistData = (email, token, proxy = null) => {
    try {
        if (!email || !token) {
            console.error(colors.error('数据不完整，无法保存'));
            return;
        }

        const currentData = loadExistingData();
        currentData[email] = { token, proxy };

        const dataEntries = Object.entries(currentData).map(([email, { token, proxy }]) => {
            return proxy ? `${email},${token},${proxy}` : `${email},${token}`;
        });

        fileSystem.writeFileSync('data.txt', dataEntries.join('\n'), 'utf8');
        console.log(colors.success('数据已保存到 data.txt'));
    } catch (error) {
        console.error(colors.error(`保存数据失败: ${error.message}`));
    }
};

// 邀请码
let INVITE_CODE = null;

// 获取邀请码
const getInviteCode = async () => {
    if (!INVITE_CODE) {
        const code = await new Promise((resolve) => {
            const rl = readlineInterface.createInterface({
                input: process.stdin,
                output: process.stdout
            });

            rl.question(colors.info('请输入邀请码: '), (code) => {
                rl.close();
                resolve(code.trim());
            });
        });
        INVITE_CODE = code;
    }
    return INVITE_CODE;
};

// 获取邀请链接
const getInviteLink = async (token, proxy = null) => {
    try {
        const result = await dynamicFetch('https://api.openloop.so/users/invite-code', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        }, proxy);
        
        if (!result.ok) {
            throw new Error(`状态码: ${result.status}`);
        }
        
        const data = await result.json();
        return data.data.inviteLink;
    } catch (error) {
        console.error(colors.error(`获取邀请链接失败: ${error.message}`));
        return null;
    }
};

// 用户认证
const authenticateUser = async (email, password, proxy = null) => {
    try {
        console.log(colors.info(`正在登录账号: ${email}`));
        
        const loginDetails = { username: email, password };
        const loginResult = await dynamicFetch('https://api.openloop.so/users/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(loginDetails),
        }, proxy);

        if (!loginResult.ok) {
            throw new Error(`登录失败! 状态码: ${loginResult.status}`);
        }

        const loginInfo = await loginResult.json();
        const userAccessToken = loginInfo.data.accessToken;
        console.log(colors.success(`账号 ${email} 登录成功`));

        persistData(email, userAccessToken, proxy);
        return userAccessToken;
    } catch (error) {
        console.error(colors.error(`登录失败: ${error.message}`));
        return null;
    }
};

// 创建用户账号
const createUserAccount = async (email, password, proxy = null) => {
    try {
        const userName = email.split('@')[0];
        
        console.log(colors.info(`开始注册账号: ${email}`));
        
        // 使用全局的INVITE_CODE
        let invitationCode = await getInviteCode();

        if (!invitationCode) {
            console.log(colors.warning('邀请码不能为空'));
            return null;
        }

        const registrationDetails = { 
            name: userName, 
            username: email, 
            password, 
            inviteCode: invitationCode 
        };

        const registrationResult = await dynamicFetch('https://api.openloop.so/users/register', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(registrationDetails),
        }, proxy);

        if (registrationResult.status === 401) {
            console.log(colors.warning('账号已存在，尝试直接登录...'));
            return await authenticateUser(email, password, proxy);
        }

        if (!registrationResult.ok) {
            const errorData = await registrationResult.json();
            throw new Error(errorData.message || `状态码: ${registrationResult.status}`);
        }

        const registrationInfo = await registrationResult.json();
        console.log(colors.success(`注册成功: ${registrationInfo.message}`));

        return await authenticateUser(email, password, proxy);
    } catch (error) {
        console.error(colors.error(`注册失败: ${error.message}`));
        console.log(colors.info('尝试直接登录...'));
        return await authenticateUser(email, password, proxy);
    }
};

// 运行节点
const runNode = async (email, token, proxy = null) => {
    try {
        const inviteLink = await getInviteLink(token, proxy);
        const inviteCode = inviteLink ? inviteLink.split('/').pop() : '获取失败';
        
        let lastBalance = 0;
        return {
            email,
            inviteCode,
            proxy: proxy || '直连',
            updateStatus: async () => {
                try {
                    const quality = Math.floor(Math.random() * (99 - 65 + 1)) + 65;
                    const shareResult = await dynamicFetch('https://api.openloop.so/bandwidth/share', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify({
                            quality: quality
                        })
                    }, proxy);
                    
                    if (shareResult.ok) {
                        const shareData = await shareResult.json();
                        if (shareData.data && shareData.data.balances) {
                            const balance = shareData.data.balances.POINT;
                            const earned = balance - lastBalance;
                            lastBalance = balance;
                            return { quality, earned, balance };
                        }
                    }
                    return { error: "获取数据失败" };
                } catch (error) {
                    return { error: `运行失败: ${error.message}` };
                }
            }
        };
    } catch (error) {
        console.error(colors.error(`运行失败: ${error.message}`));
        return { error: error.message };
    }
};

// 主执行函数
const executeMain = async () => {
    let cleanupFunctions = [];
    let runningNodes = [];

    // 启动时获取一次邀请码
    await getInviteCode();

    while (true) {
        console.clear();
        console.log(colors.highlight("\n============================================"));
        console.log(colors.success("          Openloop 带宽共享机器人           "));
        console.log(colors.highlight("============================================\n"));

        console.log(colors.highlight('\n请选择操作:'));
        console.log(colors.info('1. 注册并登录账号'));
        console.log(colors.info('2. 运行带宽共享'));
        console.log(colors.info('3. 退出程序'));

        const choice = await getUserChoice();

        switch (choice) {
            case '1':
                console.log(colors.info('开始处理账号注册/登录...'));
                const userList = loadUserData();
                for (const { email, password, proxy } of userList) {
                    await createUserAccount(email, password, proxy);
                }
                
                await new Promise((resolve) => {
                    const rl = readlineInterface.createInterface({
                        input: process.stdin,
                        output: process.stdout
                    });
                    console.log(colors.info('\n按回车键返回主菜单...'));
                    rl.question('', () => {
                        rl.close();
                        resolve();
                    });
                });
                break;

            case '2':
                cleanupFunctions.forEach(cleanup => cleanup && clearInterval(cleanup));
                cleanupFunctions = [];
                runningNodes = [];

                const existingData = loadExistingData();
                if (Object.keys(existingData).length === 0) {
                    console.log(colors.warning('未找到已登录的账号，请先注册/登录账号'));
                    await new Promise(resolve => setTimeout(resolve, 2000));
                    break;
                }

                console.clear();
                console.log(colors.success('开始运行所有账号带宽共享...\n'));
                
                for (const [email, { token, proxy }] of Object.entries(existingData)) {
                    const node = await runNode(email, token, proxy);
                    if (node) {
                        runningNodes.push(node);
                    }
                }

                // 持续更新所有节点的状态
                const updateAllNodes = async () => {
                    console.clear();
                    let line = 0;
                    for (let i = 0; i < runningNodes.length; i++) {
                        const { email, inviteCode, proxy, updateStatus } = runningNodes[i];
                        const status = await updateStatus();
                        
                        // Move the cursor to the correct line for this account
                        process.stdout.cursorTo(0, line++);
                        process.stdout.clearLine(0);
                        console.log(colors.highlight('----------------------------------------'));
                        process.stdout.cursorTo(0, line++);
                        process.stdout.clearLine(0);
                        console.log(colors.info(`账号: ${email}`));
                        process.stdout.cursorTo(0, line++);
                        process.stdout.clearLine(0);
                        console.log(colors.success(`邀请码: ${inviteCode}`));
                        process.stdout.cursorTo(0, line++);
                        process.stdout.clearLine(0);
                        console.log(colors.warning(`代理: ${proxy}`));
                        if (status.error) {
                            process.stdout.cursorTo(0, line++);
                            process.stdout.clearLine(0);
                            console.log(colors.error(`错误: ${status.error}`));
                        } else {
                            process.stdout.cursorTo(0, line++);
                            process.stdout.clearLine(0);
                            console.log(`分数: ${status.quality} | 本次收益: +${status.earned} | 总收益: ${status.balance}`);
                        }
                        process.stdout.cursorTo(0, line++);
                        process.stdout.clearLine(0);
                        console.log(colors.highlight('----------------------------------------'));
                    }
                    process.stdout.cursorTo(0, line);
                    console.log(colors.info('按 Ctrl+A+D 隐藏后台'));
                };

                // 每分钟更新一次状态
                cleanupFunctions.push(setInterval(updateAllNodes, 60000));
                await updateAllNodes();

                // 等待用户手动中断
                await new Promise(() => {});
                break;

            case '3':
                cleanupFunctions.forEach(cleanup => cleanup && clearInterval(cleanup));
                console.log(colors.success('感谢使用，再见！'));
                process.exit(0);
                break;

            default:
                console.log(colors.warning('无效的选项，请重新选择'));
                await new Promise(resolve => setTimeout(resolve, 1500));
        }
    }
};

// 获取用户选择
const getUserChoice = () => {
    return new Promise((resolve) => {
        const rl = readlineInterface.createInterface({
            input: process.stdin,
            output: process.stdout
        });

        rl.question(colors.info('请输入选项数字: '), (choice) => {
            rl.close();
            resolve(choice.trim());
        });
    });
};

// 处理程序退出
process.on('SIGINT', () => {
    console.log(colors.success('\n程序已安全退出'));
    process.exit(0);
});

// 启动程序
executeMain();
