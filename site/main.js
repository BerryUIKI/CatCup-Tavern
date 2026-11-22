// CatCup Tavern landing page: the shape switcher, the live chat window, the
// language menu and the copy buttons. No dependencies, no framework — the
// generated page carries one JSON blob with the strings this file needs.

const data = (() => {
    const node = document.getElementById('demo-data');
    try {
        return node ? JSON.parse(node.textContent) : {};
    } catch {
        return {};
    }
})();

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const copiedLabel = data.copied || 'Copied';

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

/* ── Rendering the reply deck ─────────────────────────────────────────── */

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// The deck writes *narration* and **"speech"**, blank line between paragraphs —
// the same pairing the app draws: italics in candlelight, speech in bold.
function renderParagraph(block) {
    return escapeHtml(block)
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br />');
}

function renderText(text) {
    return text
        .split(/\n{2,}/)
        .map((block) => `<p>${renderParagraph(block)}</p>`)
        .join('');
}

/* ── Shape switcher ───────────────────────────────────────────────────── */

const windowEl = document.getElementById('window');
const tabs = Array.from(document.querySelectorAll('[role="tab"][data-shape]'));

function selectShape(button, focus) {
    for (const tab of tabs) {
        const selected = tab === button;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected) {
            windowEl.setAttribute('data-shape', tab.dataset.shape);
            windowEl.setAttribute('aria-labelledby', tab.id);
        }
    }
    if (focus) {
        button.focus();
    }
}

for (const tab of tabs) {
    tab.addEventListener('click', () => selectShape(tab, false));
    tab.addEventListener('keydown', (event) => {
        const index = tabs.indexOf(tab);
        let next = -1;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            next = (index + 1) % tabs.length;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            next = (index - 1 + tabs.length) % tabs.length;
        } else if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = tabs.length - 1;
        }
        if (next >= 0) {
            event.preventDefault();
            selectShape(tabs[next], true);
        }
    });
}

/* ── The chat window ──────────────────────────────────────────────────── */

const messagesEl = document.getElementById('messages');
const transcriptEl = document.getElementById('transcript');
const emptyEl = document.getElementById('transcript-empty');
const form = document.getElementById('composer');
const input = document.getElementById('composer-input');
const sendButton = document.getElementById('send');
const stopButton = document.getElementById('stop');
const againButton = document.getElementById('demo-again');

const opening = Array.isArray(data.opening) ? data.opening : [];
const replies = Array.isArray(data.replies) ? data.replies : [];
const userLine = typeof data.userLine === 'string' ? data.userLine : '';
const charInitials = data.charInitials || 'MI';
const youInitials = data.youInitials || 'You';

let replyCount = 0;
let streaming = false;
let timer = 0;
let caret = null;
let stopRequested = false;

function nearBottom() {
    return transcriptEl.scrollHeight - transcriptEl.scrollTop - transcriptEl.clientHeight < 60;
}

function scrollToEnd(force) {
    if (force || nearBottom()) {
        transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }
}

function addMessage(kind, html) {
    const stick = nearBottom();
    const message = el('div', `msg${kind === 'you' ? ' you' : ''}`);
    const avatar = el('span', 'avatar', kind === 'you' ? youInitials : charInitials);
    if (kind === 'you') {
        avatar.classList.add('you');
    }
    const body = el('div', 'msg-body');
    body.appendChild(el('span', 'msg-name', kind === 'you' ? data.you : data.character));
    const bubble = el('div', 'bubble');
    bubble.innerHTML = html;
    body.appendChild(bubble);
    message.append(avatar, body);
    messagesEl.appendChild(message);
    emptyEl.hidden = true;
    againButton.hidden = true;
    scrollToEnd(stick);
    return bubble;
}

function resetTranscript() {
    clearTimeout(timer);
    caret = null;
    stopRequested = false;
    streaming = false;
    sendButton.hidden = false;
    stopButton.hidden = true;
    messagesEl.replaceChildren();
    // The opening scene is already on screen in the page's own markup path, so
    // only a cleared transcript asks for it to be redrawn.
    emptyEl.hidden = opening.length > 0;
    for (const item of opening) {
        addMessage('char', renderText(item.text));
    }
    replyCount = 0;
    scrollToEnd(true);
}

function setStreaming(state) {
    streaming = state;
    sendButton.hidden = state;
    stopButton.hidden = !state;
    if (state) {
        input.setAttribute('readonly', 'true');
    } else {
        input.removeAttribute('readonly');
    }
}

function finishStreaming(bubble, complete) {
    clearTimeout(timer);
    if (caret?.parentNode) {
        caret.remove();
    }
    caret = null;
    if (!complete && bubble) {
        // A stopped reply keeps the text already written, as the app does.
        bubble.setAttribute('data-stopped', 'true');
    }
    setStreaming(false);
    if (replyCount >= replies.length) {
        againButton.hidden = false;
    }
    input.focus({ preventScroll: true });
}

function streamReply(text, bubble) {
    if (reducedMotion.matches) {
        bubble.innerHTML = renderText(text);
        finishStreaming(bubble, true);
        return;
    }

    // Reveal the reply word by word, re-rendering from the plain text each
    // time: slicing the HTML instead would leave tags half-written inside the
    // bubble and the browser would close them for us in the wrong places.
    const ends = [...text.matchAll(/\S+\s*/g)].map((match) => match.index + match[0].length);
    const caretMark = el('span', 'caret');
    caret = caretMark;
    let index = 0;

    const paint = () => {
        bubble.innerHTML = renderText(text.slice(0, index < ends.length ? ends[index] : text.length));
        bubble.appendChild(caretMark);
    };
    paint();

    const tick = () => {
        if (caret !== caretMark) {
            return;
        }
        if (stopRequested) {
            stopRequested = false;
            finishStreaming(bubble, false);
            return;
        }
        if (index >= ends.length) {
            finishStreaming(bubble, true);
            return;
        }
        index += 1;
        paint();
        scrollToEnd(false);
        timer = setTimeout(tick, 24);
    };
    tick();
}

function requestReply() {
    if (replyCount >= replies.length) {
        againButton.hidden = false;
        return;
    }
    const reply = replies[replyCount];
    replyCount += 1;
    setStreaming(true);
    const bubble = addMessage('char', '');
    timer = setTimeout(() => streamReply(reply, bubble), 400);
}

form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (streaming) {
        return;
    }
    const text = input.value.trim() || userLine;
    if (!text) {
        return;
    }
    input.value = '';
    autosize();
    addMessage('you', renderText(text));
    requestReply();
});

stopButton.addEventListener('click', () => {
    if (streaming) {
        stopRequested = true;
    }
});

againButton.addEventListener('click', () => {
    resetTranscript();
    input.focus();
});

input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
        input.value = '';
        autosize();
        return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        form.requestSubmit();
    }
});

function autosize() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 76)}px`;
}

input.addEventListener('input', autosize);

resetTranscript();
autosize();

/* ── Language menu ────────────────────────────────────────────────────── */

const langButton = document.getElementById('lang-button');
const langList = document.getElementById('lang-list');

function closeLang(returnFocus) {
    if (!langList || !langButton || langList.hidden) {
        return;
    }
    langList.hidden = true;
    langButton.setAttribute('aria-expanded', 'false');
    if (returnFocus) {
        langButton.focus();
    }
}

if (langButton && langList) {
    langButton.addEventListener('click', () => {
        const open = langList.hidden;
        langList.hidden = !open;
        langButton.setAttribute('aria-expanded', String(open));
        if (open) {
            const selected = langList.querySelector('[aria-selected="true"]') || langList.querySelector('a');
            if (selected) {
                selected.focus();
            }
        }
    });

    langList.addEventListener('keydown', (event) => {
        const items = Array.from(langList.querySelectorAll('a'));
        const index = items.indexOf(document.activeElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            closeLang(true);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            items[(index + 1) % items.length].focus();
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            items[(index - 1 + items.length) % items.length].focus();
        } else if (event.key === 'Home') {
            event.preventDefault();
            items[0].focus();
        } else if (event.key === 'End') {
            event.preventDefault();
            items[items.length - 1].focus();
        }
    });

    document.addEventListener('click', (event) => {
        if (!langList.hidden && !langList.contains(event.target) && !langButton.contains(event.target)) {
            closeLang(false);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && !langList.hidden) {
            closeLang(true);
        }
    });
}

/* ── Copy buttons ─────────────────────────────────────────────────────── */

for (const button of document.querySelectorAll('[data-copy]')) {
    const original = button.textContent.trim();
    button.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(button.dataset.copy);
            button.textContent = copiedLabel;
            setTimeout(() => {
                button.textContent = original;
            }, 1600);
        } catch {
            // Clipboard access can be refused; the command stays selectable.
        }
    });
}
