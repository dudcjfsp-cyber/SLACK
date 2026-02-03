/**
 * @file config-manager.js
 * @description 사용자가 입력한 API 키(Slack, Google, Gemini)를 로컬 파일(config.json)에 저장하고 로드하는 기능을 담당합니다.
 * 이 코드는 비전공자도 이해할 수 있도록 상세한 주석을 포함하고 있습니다.
 */

const fs = require('fs');
const path = require('path');

// 설정 파일이 저장될 경로 (현재 폴더의 config.json)
const CONFIG_PATH = path.join(__dirname, 'config.json');

/**
 * 로컬에 저장된 설정을 불러옵니다.
 * 파일이 없으면 빈 객체를 반환합니다.
 * @returns {Object} 설정 정보가 담긴 객체
 */
function getConfig() {
    try {
        // 파일이 존재하는지 확인합니다.
        if (fs.existsSync(CONFIG_PATH)) {
            // 파일을 읽어서 글자(String)를 자바스크립트 객체(Object)로 변환합니다.
            const data = fs.readFileSync(CONFIG_PATH, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        console.error('설정 파일을 읽는 중 오류가 발생했습니다:', error);
    }
    // 파일이 없거나 오류가 나면 빈 설정을 돌려줍니다.
    return {};
}

/**
 * 사용자가 입력한 새로운 설정을 로컬 파일에 저장합니다.
 * @param {Object} newConfig 저장할 새로운 설정 객체
 * @returns {Boolean} 저장 성공 여부
 */
function saveConfig(newConfig) {
    try {
        // 기존 설정과 새로운 설정을 합칩니다.
        const currentConfig = getConfig();
        const mergedConfig = { ...currentConfig, ...newConfig };

        // 자바스크립트 객체를 사람이 읽기 좋은 글자 형태로 변환하여 파일에 씁니다.
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(mergedConfig, null, 2), 'utf8');
        console.log('설정이 안전하게 로컬에 저장되었습니다.');
        return true;
    } catch (error) {
        console.error('설정을 저장하는 중 오류가 발생했습니다:', error);
        return false;
    }
}

/**
 * 특정 API 키가 모두 설정되어 있는지 확인합니다.
 * @returns {Boolean} 모든 필수 설정이 존재하는지 여부
 */
function isConfigured() {
    const config = getConfig();
    const requiredFields = [
        'SLACK_SIGNING_SECRET',
        'SLACK_BOT_TOKEN',
        'GOOGLE_SERVICE_ACCOUNT_KEY',
        'GEMINI_API_KEY',
        'SELECTED_SHEET_ID'
    ];

    // 필수 항목 중 하나라도 비어있으면 false를 반환합니다.
    return requiredFields.every(field => config[field] && String(config[field]).trim() !== '');
}

module.exports = {
    getConfig,
    saveConfig,
    isConfigured
};
