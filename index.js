/**
 * @file index.js
 * @description 웹 서버의 주 진입점입니다. Express 서버를 실행하고 설정을 관리하며 슬랙 봇을 구동합니다.
 */

require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const configManager = require('./config-manager');
const slackHandler = require('./slack-handler');

const app = express();
const PORT = process.env.PORT || 3000;

// EJS 템플릿 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

/**
 * [POST/GET] 슬랙 이벤트 수신용 미들웨어
 */
app.use('/slack/events', (req, res, next) => {
    const receiver = slackHandler.getReceiver();
    if (receiver) {
        return receiver.router(req, res, next);
    }
    res.status(503).send("Slack 앱이 아직 설정되지 않았습니다.");
});

// 바디 파서 설정
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
app.use(bodyParser.json({ limit: '10mb' }));

/**
 * [GET] 메인 설정 페이지
 */
app.get('/', (req, res) => {
    const config = configManager.getConfig();
    res.render('config', { config, success: req.query.success, host: req.headers.host });
});

/**
 * [POST] 설정 저장 처리
 */
app.post('/save-config', async (req, res) => {
    const { action, ...formData } = req.body;

    // 1. 기본 설정 저장
    configManager.saveConfig(formData);

    // 2. 슬랙 앱 재구동 (설정 변경 시)
    slackHandler.initSlackApp();

    res.redirect('/?success=설정이 저장되었습니다');
});

// 서버 및 슬랙 앱 시작
app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
    console.log(`설정 페이지에 접속하여 API 키를 입력하세요.`);

    // 이미 설정이 있다면 슬랙 앱 시작
    if (configManager.isConfigured()) {
        slackHandler.initSlackApp();
        console.log("슬랙 봇이 가동되었습니다.");
    } else {
        console.log("필수 설정이 누락되어 슬랙 봇이 대기 중입니다. 웹 UI에서 설정해주세요.");
    }
});
