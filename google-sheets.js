/**
 * @file google-sheets.js
 * @description 구글 스프레드시트와의 모든 통신을 처리합니다.
 * 데이터 추가, 수정, 삭제 및 업체별 시트 자동 생성을 담당합니다.
 */

const { google } = require('googleapis');
const configManager = require('./config-manager');

/**
 * 구글 Sheets API를 사용하기 위한 인증 객체를 생성합니다.
 * 서비스 계정(JSON 키)을 사용하여 로그인 없이 인증합니다.
 */
function getSheetsClient() {
    const config = configManager.getConfig();

    // 서비스 계정 키 정보가 있는지 확인
    if (!config.GOOGLE_SERVICE_ACCOUNT_KEY) {
        throw new Error("구글 서비스 계정 설정이 필요합니다. 설정 페이지에서 JSON 키를 입력해 주세요.");
    }

    try {
        let credentials;
        if (typeof config.GOOGLE_SERVICE_ACCOUNT_KEY === 'string') {
            credentials = JSON.parse(config.GOOGLE_SERVICE_ACCOUNT_KEY);
        } else {
            credentials = config.GOOGLE_SERVICE_ACCOUNT_KEY;
        }

        if (!credentials.client_email || !credentials.private_key) {
            throw new Error("JSON 키 파일에 client_email 또는 private_key가 없습니다.");
        }

        // private_key 줄바꿈 처리
        const privateKey = credentials.private_key.replace(/\\n/g, '\n');

        const auth = new google.auth.JWT(
            credentials.client_email,
            null,
            privateKey,
            ['https://www.googleapis.com/auth/spreadsheets']
        );

        console.log("서비스 계정 인증 완료 (이메일):", credentials.client_email);
        return google.sheets({ version: 'v4', auth });
    } catch (error) {
        console.error("구글 인증 설정 오류:", error.message);
        throw error;
    }
}

/**
 * 시트 내에 특정 이름의 탭(Sheet)이 있는지 확인하고, 없으면 생성합니다.
 * @param {string} spreadsheetId 시트 ID
 * @param {string} sheetName 검색/생성할 시트 이름
 */
async function ensureSheetExists(spreadsheetId, sheetName) {
    console.log(`시트 체크 중: ${sheetName}`);
    const sheets = getSheetsClient();

    try {
        // 1. 현재 시트의 모든 탭 정보를 가져옵니다.
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const sheetExists = spreadsheet.data.sheets.some(s => s.properties.title === sheetName);

        // 2. 탭이 없으면 새로 만듭니다.
        if (!sheetExists) {
            console.log(`새로운 탭 생성 시도: ${sheetName}`);
            await sheets.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: {
                    requests: [{
                        addSheet: {
                            properties: { title: sheetName }
                        }
                    }]
                }
            });
            console.log(`성공: ${sheetName} 탭 생성됨`);

            // 헤더 추가 ([업체명], [제품명], [갯수], [Slack_TS], [날짜], [비고])
            await sheets.spreadsheets.values.update({
                spreadsheetId,
                range: `${sheetName}!A1`,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: [['업체명', '제품명', '갯수', 'Slack_TS', '날짜', '비고']]
                }
            });
            console.log(`${sheetName} 시트 헤더 생성 완료`);
        }
    } catch (error) {
        const errorMsg = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error("시트 접근 또는 생성 중 오류:", errorMsg);

        if (error.code === 403 || error.status === 403) {
            throw new Error(`시트 접근 권한이 없습니다. 시트 [공유] 설정에 서비스 계정 이메일을 추가했는지 확인해주세요.`);
        } else if (error.code === 404 || error.status === 404) {
            throw new Error(`스프레드시트를 찾을 수 없습니다. 시트 ID가 정확한지 확인해주세요.`);
        }
        throw new Error(`구글 시트 오류: ${error.message}`);
    }
}

/**
 * 데이터를 시트에 추가합니다. (통합 시트와 업체별 시트 양쪽에 입력)
 * @param {string} spreadsheetId 시트 ID
 * @param {Array} dataList [{company, product, count, ts}] 형태의 배열
 */
async function appendData(spreadsheetId, dataList) {
    const sheets = getSheetsClient();

    try {
        // 1. 스프레드시트 정보를 가져와서 첫 번째 시트(통합 시트)의 이름을 확인합니다.
        const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });
        const firstSheetName = spreadsheet.data.sheets[0].properties.title;
        console.log(`통합 시트 확인됨: ${firstSheetName}`);

        for (const item of dataList) {
            const now = new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
            // TS 앞에 '를 붙여 구글 시트가 숫자로 인식해 반올림하는 것을 방지합니다.
            const row = [item.company, item.product, item.count, `'${item.ts}`, now];
            console.log(`기록 중: [${item.company}] ${item.product} ${item.count} (TS: ${item.ts})`);

            // 1-1. 통합 시트에 추가 (첫 번째 탭)
            try {
                await sheets.spreadsheets.values.append({
                    spreadsheetId,
                    range: `${firstSheetName}!A:A`,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [row] }
                });
                console.log(`${firstSheetName} (통합) 기록 성공`);
            } catch (error) {
                console.warn(`${firstSheetName} 기록 실패:`, error.message);
            }

            // 2. 업체별 시트 확인 및 추가
            try {
                await ensureSheetExists(spreadsheetId, item.company);
                await sheets.spreadsheets.values.append({
                    spreadsheetId,
                    range: `${item.company}!A:A`,
                    valueInputOption: 'USER_ENTERED',
                    resource: { values: [row] }
                });
                console.log(`${item.company} 시트 기록 성공`);
            } catch (error) {
                console.error(`${item.company} 시트 기록 오류:`, error.message);
                throw error;
            }
        }
    } catch (error) {
        console.error("데이터 추가 중 오류 발생:", error.message);
        throw error;
    }
}

/**
 * 슬랙_TS를 기준으로 시트의 데이터를 수정합니다.
 * @param {string} spreadsheetId 시트 ID
 * @param {string} ts 슬랙 메시지 타임스탬프
 * @param {Array} newDataList 새로운 데이터 배열
 */
async function updateData(spreadsheetId, ts, newDataList) {
    console.log(`수정 요청 수신 - 대상 TS: ${ts}`);
    await deleteData(spreadsheetId, ts);
    await appendData(spreadsheetId, newDataList);
}

/**
 * 슬랙_TS를 기준으로 시트의 데이터를 삭제합니다.
 * @param {string} spreadsheetId 시트 ID
 * @param {string} ts 슬랙 메시지 타임스탬프
 */
async function deleteData(spreadsheetId, ts) {
    const sheets = getSheetsClient();
    const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

    console.log(`삭제 검색 시작 (원본 TS: ${ts})...`);
    const targetTs = String(ts).trim();

    for (const sheet of spreadsheet.data.sheets) {
        const sheetName = sheet.properties.title;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId,
            range: `${sheetName}!A:Z`,
            valueRenderOption: 'UNFORMATTED_VALUE'
        });

        const rows = response.data.values;
        if (!rows) continue;

        let deletedAny = false;
        for (let i = rows.length - 1; i >= 0; i--) {
            const currentRow = rows[i];
            const matchIndex = currentRow.findIndex(cell => {
                const cellStr = String(cell).replace(/'/g, "").trim();
                return cellStr === targetTs;
            });

            if (matchIndex !== -1) {
                // 행 보호 로직: 비고란(index 5)에 내용이 있으면 삭제 건너뜀
                const remarks = currentRow[5];
                if (remarks && String(remarks).trim() !== "") {
                    console.log(`[보호됨] ${sheetName} 탭 ${i + 1}행은 비고란에 내용이 있어 수정을 건너뜁니다. (비고: ${remarks})`);
                    continue;
                }

                console.log(`[발견] ${sheetName} 탭 ${i + 1}행 (데이터: ${currentRow[matchIndex]})`);
                await sheets.spreadsheets.batchUpdate({
                    spreadsheetId,
                    resource: {
                        requests: [{
                            deleteDimension: {
                                range: {
                                    sheetId: sheet.properties.sheetId,
                                    dimension: 'ROWS',
                                    startIndex: i,
                                    endIndex: i + 1
                                }
                            }
                        }]
                    }
                });
                deletedAny = true;
            }
        }
    }
}

module.exports = {
    appendData,
    updateData,
    deleteData,
    ensureSheetExists
};
