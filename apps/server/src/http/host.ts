/**
 * Whether a bind host stays on this machine.
 *
 * Open desktop mode relies on this: with no password there is no way to tell a
 * LAN client from the local webview, so the server refuses to start bound to
 * anything a network could reach.
 */
export function isLoopbackBind(host: string): boolean {
    const value = host.trim().toLowerCase();
    return (
        value === '127.0.0.1' ||
        value === 'localhost' ||
        value === '::1' ||
        // The IPv4-mapped form Node reports from some sockets.
        value === '::ffff:127.0.0.1'
    );
}
