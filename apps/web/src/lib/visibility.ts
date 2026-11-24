/**
 * Whether this window is out of sight right now.
 *
 * Used for one decision, made once per generation: should the owner be told over
 * IM when the reply is ready? A person watching the reply does not need a second
 * copy of the news on their phone; a person who switched away, minimised the app
 * or closed the laptop lid does.
 *
 * Read at the moment the request is sent rather than watched with a listener. A
 * window that goes hidden mid-generation still gets its answer on screen when it
 * comes back, so the interesting question is whether it was already elsewhere
 * when the work started.
 */
export function isWindowHidden(): boolean {
    return document.visibilityState !== 'visible';
}
