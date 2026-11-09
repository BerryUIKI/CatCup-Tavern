const CJK_PATTERN = /[⺀-⻿　-〿぀-ヿ㐀-䶿一-鿿豈-﫿가-힯]/u;

/**
 * Rough token estimate used for context budgeting before a real tokenizer is
 * wired in. CJK characters are roughly 1 token each; Latin text is roughly
 * 3.6 characters per token. Slightly conservative on purpose.
 */
export function estimateTokens(text: string): number {
    let cjk = 0;
    let other = 0;
    for (const char of text) {
        if (CJK_PATTERN.test(char)) {
            cjk += 1;
        } else {
            other += 1;
        }
    }
    return Math.ceil(cjk + other / 3.6);
}

export function estimateMessagesTokens(messages: { content: string }[]): number {
    return messages.reduce((sum, message) => sum + estimateTokens(message.content) + 4, 0);
}
