export function formatMessageTime(value?: string): string {
    if (!value) {
        return '';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
    return `${count} ${count === 1 ? singular : plural}`;
}

export function truncate(value: string, length = 60): string {
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}
