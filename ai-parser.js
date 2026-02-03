/**
 * @file ai-parser.js
 * @description 슬랙 메시지를 분석하여 [업체명, 제품명, 갯수] 형태로 변환합니다.
 * 정규식을 이용한 빠른 처리와 Gemini AI를 이용한 정밀 분석을 함께 사용합니다.
 * 비전공자도 이해할 수 있도록 상세한 주석을 달았습니다.
 */

const { GoogleGenerativeAI } = require("@google/generative-ai");
const configManager = require("./config-manager");

/**
 * 사용 가능한 Gemini 모델 중 가장 최적의 모델(예: gemini-1.5-flash)을 찾아 반환합니다.
 * @returns {string} 선택된 모델 이름
 */
async function getBestModel() {
    const config = configManager.getConfig();
    if (!config.GEMINI_API_KEY) return "gemini-1.5-flash";

    try {
        const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
        // 실제 운영 환경에서는 모델 리스트를 조회하여 체크할 수 있지만,
        // 현재 가장 가성비 좋고 빠른 'gemini-1.5-flash'를 기본으로 추천합니다.
        return "gemini-1.5-flash";
    } catch (error) {
        console.error("모델 조회 중 오류 발생:", error);
        return "gemini-1.5-flash"; // 오류 시 기본값 사용
    }
}

/**
 * 제품명(큰거, 녹색, 파랑)에 대해 오탈자를 교정합니다.
 * @param {string} product 사용자가 입력한 제품명
 * @returns {string} 교정된 제품명 또는 원본
 */
function normalizeProduct(product) {
    if (!product) return product;

    const mapping = {
        '큰거': ['근거', '큰거', '큰것', '크거', '큼거', '큰', '대'],
        '녹색': ['녹색', '녹섹', '노색', '눅색', '녹색색', '초록', '초록색', '그린'],
        '파랑': ['파랑', '파랑색', '파란', '파라', '퍼렁', '파랑이', '파랑색', '블루']
    };

    const trimmedProduct = product.trim();

    for (const [key, variants] of Object.entries(mapping)) {
        // 완전 일치하거나, 변형 목록에 포함되어 있거나, 키워드를 포함하는 경우
        if (variants.includes(trimmedProduct) || trimmedProduct.includes(key)) {
            return key;
        }
    }
    return product;
}

/**
 * 정규식(Regex)을 사용하여 단순한 패턴의 메시지를 AI 없이 빠르게 파싱합니다.
 * 예: "일억원 큰거 10 파랑 10" -> [{company: "일억원", product: "큰거", count: 10}, ...]
 * @param {string} text 슬랙 메시지 원문
 * @returns {Array|null} 파싱 결과 배열 또는 실패 시 null
 */
function fastParse(text) {
    // 공백으로 나눕니다.
    const parts = text.trim().split(/\s+/);
    if (parts.length < 3) return null;

    const company = parts[0];
    const results = [];

    // 업체명 이후 [제품명 갯수] 쌍이 반복되는지 확인합니다.
    for (let i = 1; i < parts.length; i += 2) {
        let product = parts[i];
        const countStr = parts[i + 1];
        const count = parseInt(countStr);

        // 제품명과 숫자가 정확히 매칭되는지 체크
        if (product && !isNaN(count)) {
            // 오탈자 교정 적용
            product = normalizeProduct(product);
            results.push({ company, product, count, ts: null });
        } else {
            // 패턴이 깨지면 AI에게 넘기기 위해 null 반환
            return null;
        }
    }

    return results.length > 0 ? results : null;
}

/**
 * Gemini AI를 사용하여 복잡한 문장 형태의 메시지를 분석합니다.
 * @param {string} text 슬랙 메시지 원문
 * @returns {Promise<Array>} 파싱된 데이터 배열
 */
async function aiParse(text) {
    const config = configManager.getConfig();
    if (!config.GEMINI_API_KEY) {
        throw new Error("Gemini API 키가 설정되지 않았습니다.");
    }

    const modelName = await getBestModel();
    const genAI = new GoogleGenerativeAI(config.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    const prompt = `
    다음은 슬랙에서 전송된 주문 메시지입니다. 
    메시지 내용에서 [업체명], [제품명], [갯수] 데이터를 추출해서 JSON 배열 형태로 응답해주세요.
    하나의 업체에 여러 제품이 올 경우, 각 제품별로 객체를 만들어주세요.
    
    제품명은 반드시 다음 세 가지 중 하나로 정규화해야 합니다: [큰거, 녹색, 파랑]
    비슷한 발음이나 의미의 단어가 오면 위 세 가지 중 가장 적절한 것으로 변환하세요.
    
    예시 입력: "일억원 근거 10 파랑색 15"
    예시 출력: [{"company": "일억원", "product": "큰거", "count": 10}, {"company": "일억원", "product": "파랑", "count": 15}]
    
    메시지: "${text}"
    
    주의: JSON 외의 설명은 하지 마세요. 오직 JSON 배열만 출력하세요.
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const jsonText = response.text().replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(jsonText);

        // AI 결과에 대해서도 한 번 더 로컬에서 정규화 수행
        return parsed.map(item => ({
            ...item,
            product: normalizeProduct(item.product)
        }));
    } catch (error) {
        console.error("AI 분석 중 오류 발생:", error);
        return [];
    }
}

/**
 * 최종 파싱 함수 (빠른 파싱 시도 후 실패 시 AI 사용)
 * @param {string} text 메시지 원문
 * @returns {Promise<Array>} 분석 결과
 */
async function parseMessage(text) {
    // 1. 먼저 정규식으로 가성비 있게 시도 (비용 0원)
    const quickResult = fastParse(text);
    if (quickResult) {
        console.log("정규식으로 파싱 성공 (API 절약)");
        return quickResult;
    }

    // 2. 실패하거나 복잡하면 AI 호출
    console.log("복잡한 문장으로 판단되어 Gemini AI를 호출합니다.");
    return await aiParse(text);
}

module.exports = {
    parseMessage,
    getBestModel
};
