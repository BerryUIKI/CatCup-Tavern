function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Trim a group reply the way SillyTavern's `cleanGroupMessage` does.
 *
 * Models often carry on another member's line or repeat the speaker's name.
 * The reply is cut at the first line that starts with another member's name,
 * and a leading `Speaker:` prefix is removed.
 */
export function cleanGroupReply(text: string, speakerName: string, otherNames: readonly string[]): string {
    let result = text.replace(/\r\n?/g, '\n');

    if (speakerName.trim()) {
        // SillyTavern strips `Speaker:` at the start of every line, not only the
        // first, because group prompts prefix history that way.
        result = result.replace(new RegExp(`(^|\\n)\\s*${escapeRegExp(speakerName)}\\s*:\\s*`, 'gi'), '$1');
    }

    for (const name of otherNames) {
        if (!name.trim() || name === speakerName) {
            continue;
        }
        const pattern = new RegExp(`(^|\\n)\\s*${escapeRegExp(name)}\\s*:`, 'i');
        const match = pattern.exec(result);
        if (match) {
            result = result.slice(0, match.index + (match[1] ? match[1].length : 0));
        }
    }

    return result.trim();
}

/**
 * The avatar URL SillyTavern stores on group messages.
 *
 * CatCup itself resolves avatars from `original_avatar`; writing this URL too
 * means a chat copied into SillyTavern shows the right speaker avatar.
 */
export function stForceAvatarUrl(fileName: string): string {
    return `/thumbnail?type=avatar&file=${encodeURIComponent(fileName)}`;
}
