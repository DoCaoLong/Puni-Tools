const fs = require('fs');
const path = require('path');
const axios = require('axios');
const colors = require('colors');
const readline = require('readline');
const { DateTime } = require('luxon');
const crypto = require('crypto');

class UniquidAPIClient {
    constructor() {
        this.headers = {
            "Accept": "application/json, text/plain, */*",
            "Accept-Encoding": "gzip, deflate, br",
            "Accept-Language": "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
            "Content-Type": "application/json",
            "Origin": "https://miniapp.uniquid.io",
            "Referer": "https://miniapp.uniquid.io/",
            "Sec-Ch-Ua": '"Not/A)Brand";v="99", "Google Chrome";v="115", "Chromium";v="115"',
            "Sec-Ch-Ua-Mobile": "?0",
            "Sec-Ch-Ua-Platform": '"Windows"',
            "Sec-Fetch-Dest": "empty",
            "Sec-Fetch-Mode": "cors",
            "Sec-Fetch-Site": "same-site",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        };
        this.tokenFile = path.join(__dirname, 'token.json');
        this.isRunning = true;
    }

    generateTP(initData) {
        const input = initData || "a";
        return crypto.createHash('md5').update(input).digest('hex');
    }

    log(msg, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        switch(type) {
            case 'success':
                console.log(`[${timestamp}] [✓] ${msg}`.green);
                break;
            case 'custom':
                console.log(`[${timestamp}] [*] ${msg}`.magenta);
                break;        
            case 'error':
                console.log(`[${timestamp}] [✗] ${msg}`.red);
                break;
            case 'warning':
                console.log(`[${timestamp}] [!] ${msg}`.yellow);
                break;
            default:
                console.log(`[${timestamp}] [ℹ] ${msg}`.blue);
        }
    }

    async countdown(seconds) {
        for (let i = seconds; i > 0; i--) {
            const timestamp = new Date().toLocaleTimeString();
            readline.cursorTo(process.stdout, 0);
            process.stdout.write(`[${timestamp}] [*] Chờ ${i} giây để tiếp tục...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        readline.cursorTo(process.stdout, 0);
        readline.clearLine(process.stdout, 0);
    }

    isExpired(token) {
        if (!token) return true;
        
        const [header, payload, sign] = token.split('.');
        if (!payload) return true;
        
        try {
            const decodedPayload = Buffer.from(payload, 'base64').toString();
            const parsedPayload = JSON.parse(decodedPayload);
            const now = Math.floor(DateTime.now().toSeconds());
            
            if (parsedPayload.exp) {
                const expirationDate = DateTime.fromSeconds(parsedPayload.exp).toLocal();
                this.log(`Token hết hạn vào: ${expirationDate.toFormat('yyyy-MM-dd HH:mm:ss')}`, 'custom');
                
                const isExpired = now > parsedPayload.exp;
                this.log(`Token đã hết hạn chưa? ${isExpired ? 'Đúng rồi bạn cần thay token' : 'Chưa..chạy tẹt ga đi'}`, 'custom');
                
                return isExpired;
            }
            this.log(`Token vĩnh cửu không đọc được thời gian hết hạn`, 'warning');
            return false;
        } catch (error) {
            this.log(`Lỗi khi kiểm tra token: ${error.message}`, 'error');
            return true;
        }
    }

    loadTokens() {
        try {
            if (fs.existsSync(this.tokenFile)) {
                return JSON.parse(fs.readFileSync(this.tokenFile, 'utf8'));
            }
            return {};
        } catch (error) {
            this.log(`Lỗi khi đọc file token: ${error.message}`, 'error');
            return {};
        }
    }

    saveToken(userId, token, initData) {
        try {
            const tokens = this.loadTokens();
            const tp = this.generateTP(initData);
            tokens[userId] = {
                token,
                initData,
                tp
            };
            fs.writeFileSync(this.tokenFile, JSON.stringify(tokens, null, 2));
            this.log(`Lưu token thành công cho user ${userId}`, 'success');
            return { token, tp };
        } catch (error) {
            this.log(`Lỗi khi lưu token: ${error.message}`, 'error');
            return null;
        }
    }

    async login(initData) {
        const url = "https://api.uniquid.io/mainnet/user/login";
        const payload = {
            initData: initData,
            rel: initData.split('start_param=')[1].split('&')[0],
            give: 0
        };

        try {
            const response = await axios.post(url, payload, { headers: this.headers });
            if (response.status === 201 && response.data.code === 0) {
                const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
                this.log(`Đăng nhập thành công tài khoản: ${userData.username}!`, 'success');
                return {
                    success: true,
                    token: response.data.data.access_token,
                    isNew: response.data.data.is_new,
                    userId: userData.id
                };
            } else {
                throw new Error(response.data.msg || 'Lỗi không xác định khi đăng nhập');
            }
        } catch (error) {
            this.log(`Lỗi đăng nhập: ${error.message}`, 'error');
            return { success: false, error: error.message };
        }
    }

    async getUserProfile(userId, token, tp) {
        if (!token || !tp) {
            this.log(`Thiếu thông tin token hoặc tp cho user ${userId}`, 'error');
            return null;
        }

        try {
            const url = `https://api.uniquid.io/mainnet/user/profile?m=${tp}`;
            const response = await axios.get(url, {
                headers: {
                    ...this.headers,
                    "Authorization": `Bearer ${token}`
                }
            });

            if (response.data.code !== 0) {
                throw new Error(response.data.msg || 'Lỗi không xác định khi lấy profile');
            }

            return response.data;
        } catch (error) {
            this.log(`Lỗi khi lấy thông tin profile: ${error.message}`, 'error');
            return null;
        }
    }

    async getTaskList(userId, token, tp) {
        if (!token || !tp) {
            this.log(`Thiếu thông tin token hoặc tp cho user ${userId}`, 'error');
            return null;
        }

        try {
            const url = `https://api.uniquid.io/mainnet/task/list?m=${tp}`;
            const response = await axios.get(url, {
                headers: {
                    ...this.headers,
                    "Authorization": `Bearer ${token}`
                }
            });

            if (response.data.code !== 0) {
                throw new Error(response.data.msg || 'Lỗi không xác định khi lấy danh sách nhiệm vụ');
            }

            return response.data.data.list;
        } catch (error) {
            this.log(`Lỗi khi lấy danh sách nhiệm vụ: ${error.message}`, 'error');
            return null;
        }
    }

    async checkTask(type, userId, token, tp) {
        if (!token || !tp) {
            this.log(`Thiếu thông tin token hoặc tp cho user ${userId}`, 'error');
            return false;
        }

        try {
            const url = `https://api.uniquid.io/mainnet/task/check?m=${tp}`;
            const payload = { type };
            
            const response = await axios.post(url, payload, {
                headers: {
                    ...this.headers,
                    "Authorization": `Bearer ${token}`
                }
            });

            if (response.data.code !== 0) {
                throw new Error(response.data.msg || 'Lỗi không xác định khi kiểm tra nhiệm vụ');
            }

            return true;
        } catch (error) {
            this.log(`Lỗi khi kiểm tra nhiệm vụ ${type}: ${error.message}`, 'error');
            return false;
        }
    }

    async getQuestion(userId, token, tp) {
        if (!token || !tp) {
            this.log(`Thiếu thông tin token hoặc tp cho user ${userId}`, 'error');
            return null;
        }

        try {
            const url = `https://api.uniquid.io/mainnet/user/getQuestion?m=${tp}`;
            const response = await axios.get(url, {
                headers: {
                    ...this.headers,
                    "Authorization": `Bearer ${token}`
                }
            });

            if (response.data.code !== 0) {
                throw new Error(response.data.msg || 'Lỗi không xác định khi lấy câu hỏi');
            }

            return response.data.data.question;
        } catch (error) {
            this.log(`Lỗi khi lấy câu hỏi: ${error.message}`, 'error');
            return null;
        }
    }

    async submitAnswer(userId, token, tp, answer) {
        if (!token || !tp) {
            this.log(`Thiếu thông tin token hoặc tp cho user ${userId}`, 'error');
            return null;
        }

        try {
            const url = `https://api.uniquid.io/mainnet/user/answer?m=${tp}`;
            const payload = { answer };
            
            const response = await axios.post(url, payload, {
                headers: {
                    ...this.headers,
                    "Authorization": `Bearer ${token}`
                }
            });

            if (response.data.code !== 0) {
                throw new Error(response.data.msg || 'Lỗi không xác định khi trả lời câu hỏi');
            }

            return response.data.data;
        } catch (error) {
            this.log(`Lỗi khi trả lời câu hỏi: ${error.message}`, 'error');
            return null;
        }
    }

    async handleQuiz(userId, token, tp, chances) {
        if (chances <= 0) {
            this.log(`Không còn chances để trả lời câu hỏi`, 'warning');
            return;
        }

        this.log(`Bắt đầu trả lời câu hỏi với ${chances} chances`, 'custom');

        while (chances > 0) {
            const question = await this.getQuestion(userId, token, tp);
            if (!question) {
                this.log(`Không thể lấy câu hỏi`, 'error');
                break;
            }

            this.log(`Câu hỏi: ${question.question}`, 'info');
            this.log(`Lựa chọn: ${question.options.join(' | ')}`, 'info');

//            const randomAnswer = Math.floor(Math.random() * 2);
            const randomAnswer = 0;
            const result = await this.submitAnswer(userId, token, tp, randomAnswer);

            if (result) {
                if (result.correct === 1) {
                    this.log(`Bạn trả lời đúng.. nhận ${result.points} Points`, 'success');
                } else {
                    this.log(`Bạn trả lời sai`, 'error');
                }
                chances--;
                this.log(`Còn lại ${chances} chances`, 'custom');

                const delay = Math.floor(Math.random() * (3000 - 1000 + 1)) + 1000;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    async processAllTasks(userId, token, tp) {
        if (!token || !tp) {
            this.log(`Thiếu thông tin token hoặc tp cho user ${userId}`, 'error');
            return;
        }

        try {
            const taskList = await this.getTaskList(userId, token, tp);
            if (!taskList) {
                this.log('Không thể lấy danh sách nhiệm vụ', 'error');
                return;
            }

            const profile = await this.getUserProfile(userId, token, tp);
            if (!profile || !profile.data) {
                this.log('Không thể lấy thông tin profile', 'error');
                return;
            }

            const completedTasks = [
                ...(profile.data.dailyTaskList || []),
                ...(profile.data.taskList || [])
            ];

            this.log(`Đã hoàn thành ${completedTasks.length} nhiệm vụ`, 'info');
            this.log(`Point: ${profile.data.point} | Chances: ${profile.data.chances}`, 'custom');

            for (const task of taskList) {
                if (task.type === 'ConnectOkx') {
                    this.log(`Bỏ qua nhiệm vụ ConnectOkx`, 'warning');
                    continue;
                }

                if (completedTasks.includes(task.type)) {
                    this.log(`Nhiệm vụ ${task.type} đã hoàn thành trước đó`, 'warning');
                    continue;
                }

                this.log(`Đang xử lý nhiệm vụ: ${task.type}`, 'info');
                const success = await this.checkTask(task.type, userId, token, tp);
                
                if (success) {
                    this.log(`Làm nhiệm vụ ${task.type} thành công | Phần thưởng: ${task.points} Points ${task.chances} Chances`, 'success');
                    
                    const delay = Math.floor(Math.random() * (3000 - 1000 + 1)) + 1000;
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
            }

            const updatedProfile = await this.getUserProfile(userId, token, tp);
            if (updatedProfile && updatedProfile.data) {
                this.log(`=== Cập nhật sau khi làm nhiệm vụ ===`, 'custom');
                this.log(`Point: ${updatedProfile.data.point} | Chances: ${updatedProfile.data.chances}`, 'custom');
                this.log(`Rank: ${updatedProfile.data.rank} | Month Points: ${updatedProfile.data.monthPoint}`, 'custom');

                if (updatedProfile.data.chances > 0) {
                    await this.handleQuiz(userId, token, tp, updatedProfile.data.chances);
                }
            }

        } catch (error) {
            this.log(`Lỗi khi xử lý nhiệm vụ: ${error.message}`, 'error');
        }
    }

    async getUserTaskSummary(userId, token, tp) {
        const profile = await this.getUserProfile(userId, token, tp);
        if (!profile || !profile.data) return null;

        return {
            dailyTasks: profile.data.dailyTaskList || [],
            regularTasks: profile.data.taskList || [],
            stats: {
                points: profile.data.point,
                chances: profile.data.chances,
                rank: profile.data.rank,
                monthPoints: profile.data.monthPoint,
                correct: profile.data.correct,
                wrong: profile.data.wrong
            }
        };
    }

    async main() {
        const dataFile = path.join(__dirname, 'data.txt');
        const data = fs.readFileSync(dataFile, 'utf8')
            .replace(/\r/g, '')
            .split('\n')
            .filter(Boolean);

        const tokens = this.loadTokens();
        while(true) {
            for (let i = 0; i < data.length; i++) {
                const initData = data[i];
                const userData = JSON.parse(decodeURIComponent(initData.split('user=')[1].split('&')[0]));
                const userId = userData.id;

                console.log(`========== Tài khoản ${i + 1} | ${userData.first_name.green} ==========`);
                
                let currentToken = tokens[userId]?.token;
                let currentTP = tokens[userId]?.tp;
                let needNewToken = true;

                if (currentToken) {
                    this.log('Đang kiểm tra token...', 'info');
                    if (!this.isExpired(currentToken)) {
                        this.log('Token còn hạn, tiếp tục sử dụng', 'success');
                        needNewToken = false;
                    } else {
                        this.log('Token đã hết hạn, tiến hành đăng nhập lại', 'warning');
                    }
                } else {
                    this.log('Không tìm thấy token, tiến hành đăng nhập', 'info');
                }

                if (needNewToken) {
                    const loginResult = await this.login(initData);
                    if (loginResult.success) {
                        const savedData = this.saveToken(loginResult.userId, loginResult.token, initData);
                        if (savedData) {
                            currentToken = savedData.token;
                            currentTP = savedData.tp;
                        }
                    } else {
                        this.log(`Đăng nhập không thành công: ${loginResult.error}`, 'error');
                        continue;
                    }
                }

                const profile = await this.getUserProfile(userId, currentToken, currentTP);
                if (profile && profile.data) {
                    const { point, correct, wrong } = profile.data;
                    this.log(`Point: ${point} | Đúng: ${correct} | Sai: ${wrong}`, 'custom');
                }

                await this.processAllTasks(userId, currentToken, currentTP);

                await this.countdown(2);
            }
            await this.countdown(86400);
        }
    }
}

const client = new UniquidAPIClient();
client.main().catch(err => {
    client.log(err.message, 'error');
    process.exit(1);
});