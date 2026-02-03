/**
 * @file slack-handler.js
 * @description 슬랙에서 발생하는 메시지 생성, 수정, 삭제 이벤트를 감지하여 처리합니다.
 */

const { App, ExpressReceiver } = require('@slack/bolt');
const aiParser = require('./ai-parser');
const googleSheets = require('./google-sheets');
const configManager = require('./config-manager');

let app;
let receiver;

/**
 * 슬랙 앱을 초기화하고 이벤트 리스너를 등록합니다.
 */
function initSlackApp() {
    const config = configManager.getConfig();

    if (!config.SLACK_BOT_TOKEN || !config.SLACK_SIGNING_SECRET) {
        console.warn("슬랙 설정이 완료되지 않아 앱을 시작할 수 없습니다.");
        return null;
    }

    // Express와 통합하기 위한 Receiver 생성
    receiver = new ExpressReceiver({
        signingSecret: config.SLACK_SIGNING_SECRET,
        processBeforeResponse: true,
        endpoints: '/' // index.js에서 /slack/events로 마운트하므로 여기서는 '/'로 설정해야 경로 중첩이 방지됩니다.
    });

    app = new App({
        token: config.SLACK_BOT_TOKEN,
        receiver: receiver
    });

    /**
     * 새로운 메시지가 올라왔을 때 (승인 단계 추가)
     */
    app.message(async ({ message, client }) => {
        if (message.subtype) return;

        try {
            console.log("새 메시지 수신:", message.text);
            const parsedData = await aiParser.parseMessage(message.text);

            if (parsedData && parsedData.length > 0) {
                const companyName = parsedData[0].company;

                // 사용자에게 확인 버튼이 포함된 메시지를 보냅니다.
                await client.chat.postMessage({
                    channel: message.channel,
                    thread_ts: message.ts,
                    text: `업체명이 [${companyName}] 이 맞나요?`,
                    blocks: [
                        {
                            type: "section",
                            text: {
                                type: "mrkdwn",
                                text: `*업체확인:* 업체명이 *${companyName}* 이 맞나요? \n하단의 승인 버튼을 누르면 시트에 기록됩니다.`
                            }
                        },
                        {
                            type: "actions",
                            elements: [
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "승인" },
                                    style: "primary",
                                    action_id: "approve_order",
                                    value: JSON.stringify(parsedData.map(item => ({ ...item, ts: message.ts })))
                                },
                                {
                                    type: "button",
                                    text: { type: "plain_text", text: "취소" },
                                    style: "danger",
                                    action_id: "cancel_order"
                                }
                            ]
                        }
                    ]
                });
            }
        } catch (error) {
            console.error("메시지 처리 중 오류:", error);
        }
    });

    /**
     * [승인] 버튼 클릭 시 처리
     */
    app.action('approve_order', async ({ ack, body, client, action }) => {
        await ack(); // 슬랙 서버에 수신 확인 응답

        try {
            console.log("승인 데이터 파싱 시도:", action.value);
            const dataToSave = JSON.parse(action.value);
            const config = configManager.getConfig();

            if (config.SELECTED_SHEET_ID) {
                console.log("시트 기록 시작 (ID):", config.SELECTED_SHEET_ID);
                await googleSheets.appendData(config.SELECTED_SHEET_ID, dataToSave);
                console.log("시트 기록 완료");

                // 기존 확인 메시지를 성공 메시지로 업데이트합니다.
                await client.chat.update({
                    channel: body.channel.id,
                    ts: body.message.ts,
                    text: "✅ 성공적으로 구글 시트에 기록되었습니다!",
                    blocks: [
                        {
                            type: "section",
                            text: { type: "mrkdwn", text: `✅ *[${dataToSave[0].company}]* 데이터가 시트에 기록되었습니다.` }
                        }
                    ]
                });
            }
        } catch (error) {
            console.error("승인 처리 중 오류:", error);
            // 에러 메시지를 슬랙으로 전송하여 사용자에게 알립니다.
            await client.chat.postMessage({
                channel: body.channel.id,
                thread_ts: body.message.ts,
                text: `⚠️ 기록 실패: ${error.message}`
            });
        }
    });

    /**
     * [취소] 버튼 클릭 시 처리
     */
    app.action('cancel_order', async ({ ack, body, client }) => {
        await ack();

        await client.chat.update({
            channel: body.channel.id,
            ts: body.message.ts,
            text: "❌ 취소되었습니다.",
            blocks: [
                {
                    type: "section",
                    text: { type: "mrkdwn", text: "❌ 시트 입력이 취소되었습니다." }
                }
            ]
        });
    });

    /**
     * 메시지가 수정되었을 때
     */
    app.event('message', async ({ event }) => {
        if (event.subtype === 'message_changed') {
            const newMessage = event.message;
            console.log("메시지 수정됨:", newMessage.text);

            try {
                const parsedData = await aiParser.parseMessage(newMessage.text);
                const dataWithTs = parsedData.map(item => ({ ...item, ts: newMessage.ts }));

                const config = configManager.getConfig();
                if (config.SELECTED_SHEET_ID) {
                    await googleSheets.updateData(config.SELECTED_SHEET_ID, newMessage.ts, dataWithTs);
                    console.log("시트 수정 완료");
                }
            } catch (error) {
                console.error("수정 처리 중 오류:", error);
            }
        }

        /**
         * 메시지가 삭제되었을 때
         */
        if (event.subtype === 'message_deleted') {
            console.log("메시지 삭제됨, TS:", event.deleted_ts);

            try {
                const config = configManager.getConfig();
                if (config.SELECTED_SHEET_ID) {
                    await googleSheets.deleteData(config.SELECTED_SHEET_ID, event.deleted_ts);
                    console.log("시트에서 데이터 삭제 완료");
                }
            } catch (error) {
                console.error("삭제 처리 중 오류:", error);
            }
        }
    });

    return app;
}

module.exports = {
    initSlackApp,
    getApp: () => app,
    getReceiver: () => receiver
};
