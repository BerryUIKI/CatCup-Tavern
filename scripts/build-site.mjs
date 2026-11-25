// Builds the CatCup Tavern landing page for every locale.
//
//     node scripts/build-site.mjs
//
// Reads site/content/<code>.json, renders site/template.html and writes one
// folder per locale into site/dist: English at the root, every other locale
// under its own code. No dependencies, and it fails loudly when a locale is
// missing a key or carries one the source no longer has — a half-translated
// page never ships.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const siteDir = join(root, 'site');
const contentDir = join(siteDir, 'content');
const outDir = join(siteDir, 'dist');

const SITE_URL = 'https://berryuiki.github.io/CatCup-Tavern';
const REPO_URL = 'https://github.com/BerryUIKI/CatCup-Tavern';
const SOURCE = 'en';

// The installer asset is named after the version by the Tauri bundler, so the
// direct link has to be rebuilt whenever the version changes rather than
// pointing at `releases/latest`, which would land on the release page instead
// of on a download.
const installerUrl = (version) => {
    const asset = encodeURIComponent(`CatCup.Tavern_${version}_x64-setup.exe`);
    return `${REPO_URL}/releases/download/v${version}/${asset}`;
};

// Endonyms, in the order the language menu lists them. `code` doubles as the
// folder name and the `hreflang` value.
const LOCALES = [
    { code: 'en', name: 'English', htmlLang: 'en', dir: 'ltr' },
    { code: 'zh-CN', name: '简体中文', htmlLang: 'zh-CN', dir: 'ltr' },
    { code: 'ja', name: '日本語', htmlLang: 'ja', dir: 'ltr' },
    { code: 'ko', name: '한국어', htmlLang: 'ko', dir: 'ltr' },
    { code: 'de', name: 'Deutsch', htmlLang: 'de', dir: 'ltr' },
    { code: 'fr', name: 'Français', htmlLang: 'fr', dir: 'ltr' },
    { code: 'es', name: 'Español', htmlLang: 'es', dir: 'ltr' },
    { code: 'ru', name: 'Русский', htmlLang: 'ru', dir: 'ltr' },
    { code: 'pt-BR', name: 'Português (Brasil)', htmlLang: 'pt-BR', dir: 'ltr' },
];

/* ── Key checking ────────────────────────────────────────────────────── */

/** The key paths of a deck, with list indices folded to `[]` so translations
 *  may hold a different number of items. */
function keyPaths(value, prefix = '', out = new Set()) {
    if (Array.isArray(value)) {
        for (const item of value) {
            keyPaths(item, `${prefix}[]`, out);
        }
    } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            keyPaths(child, prefix ? `${prefix}.${key}` : key, out);
        }
    } else {
        out.add(prefix);
    }
    return out;
}

function checkKeys(source, other, code) {
    const expected = keyPaths(source);
    const actual = keyPaths(other);
    const missing = [...expected].filter((key) => !actual.has(key));
    const extra = [...actual].filter((key) => !expected.has(key));
    if (missing.length || extra.length) {
        const lines = [`locale ${code} does not match ${SOURCE}:`];
        if (missing.length) {
            lines.push(`  missing: ${missing.join(', ')}`);
        }
        if (extra.length) {
            lines.push(`  unused:  ${extra.join(', ')}`);
        }
        throw new Error(lines.join('\n'));
    }
}

/* ── A very small template ───────────────────────────────────────────── */

const SECTION = /\{\{([#^])([\w.]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g;

function lookup(context, path) {
    return path.split('.').reduce((value, key) => (value == null ? undefined : value[key]), context);
}

function asItem(item, index, length) {
    const fields = item && typeof item === 'object' && !Array.isArray(item) ? item : { '.': item };
    return { ...fields, index, first: index === 0, last: index === length - 1 };
}

function renderSections(template, context) {
    return template.replace(SECTION, (_match, sigil, path, body) => {
        const value = lookup(context, path);
        if (sigil === '^') {
            const empty = value === undefined || value === null || value === false || value === '';
            return empty ? renderSections(body, context) : '';
        }
        if (Array.isArray(value)) {
            return value
                .map((item, index) => fillValues(body, { ...context, ...asItem(item, index, value.length) }))
                .join('');
        }
        if (value && typeof value === 'object') {
            return fillValues(body, { ...context, ...value });
        }
        return value ? fillValues(body, context) : '';
    });
}

function fillValues(template, context) {
    // Longest path first, so {{features.rows.0.name}} is not eaten by {{features}}.
    // {{.}} is the current list item, so it is replaced before any dotted path
    // and never has to compete with one.
    let html = template.split('{{.}}').join(String(context['.'] ?? ''));
    const paths = Object.keys(context).sort((a, b) => b.length - a.length);
    for (const path of paths) {
        const value = lookup(context, path);
        if (value === undefined || value === null || typeof value === 'object') {
            continue;
        }
        const text = String(value);
        html = html.split(`{{{${path}}}}`).join(text).split(`{{${path}}}`).join(text);
    }
    return html;
}

function render(template, context) {
    // Lists do not nest in these decks, so one pass fills a slice's values and
    // a second fills what is left outside it.
    return fillValues(renderSections(template, context), context);
}

/* ── The page ────────────────────────────────────────────────────────── */

const href = (code) => (code === SOURCE ? `${SITE_URL}/` : `${SITE_URL}/${code}/`);

// A link from one locale's page to another has to be relative to the page it
// sits on, not to the site root. `./` and `../zh-CN/` only happen to work from
// inside a locale folder: on the English page they point outside the project
// entirely, which is how every language link once landed on the profile site.
function relativeLink(fromCode, toCode) {
    const fromSegment = new URL('.', href(fromCode)).pathname.split('/').filter(Boolean);
    const toSegment = new URL(href(toCode)).pathname.split('/').filter(Boolean);
    let shared = 0;
    while (shared < fromSegment.length && shared < toSegment.length && fromSegment[shared] === toSegment[shared]) {
        shared += 1;
    }
    const up = '../'.repeat(fromSegment.length - shared);
    const down = toSegment.slice(shared).join('/');
    const link = up + (down ? `${down}/` : '');
    return link || './';
}

function jsonLd(deck, code, version) {
    return JSON.stringify(
        {
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'CatCup Tavern',
            applicationCategory: 'EntertainmentApplication',
            operatingSystem: 'Windows; web and LAN from source',
            softwareVersion: version,
            license: 'https://www.gnu.org/licenses/agpl-3.0.html',
            url: href(code),
            inLanguage: code,
            downloadUrl: `${REPO_URL}/releases/latest`,
            offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
            description: deck.meta.description,
            featureList: deck.features.rows.map((row) => row.name),
            author: { '@type': 'Organization', name: 'BerryUIKI', url: 'https://github.com/BerryUIKI' },
        },
        null,
        2,
    );
}

// CATCUP_SITE_ONLY=de,fr builds just those locales, for working on one
// translation without the other seven being finished. Always empty in CI.
const selected = process.env.CATCUP_SITE_ONLY
    ? LOCALES.filter((locale) => process.env.CATCUP_SITE_ONLY.split(',').includes(locale.code))
    : LOCALES;

/** The deck as dotted paths to its leaves; arrays keep square-bracket indices. */
function flatten(value, prefix = '', out = {}) {
    if (Array.isArray(value)) {
        for (const [index, item] of value.entries()) {
            flatten(item, `${prefix}[${index}]`, out);
        }
    } else if (value && typeof value === 'object') {
        for (const [key, child] of Object.entries(value)) {
            flatten(child, prefix ? `${prefix}.${key}` : key, out);
        }
    } else {
        out[prefix] = value;
        // The template may also address an item as .0. rather than [0].
        if (prefix.includes('[')) {
            out[prefix.replace(/\[(\d+)\]/g, '.$1')] = value;
        }
    }
    return out;
}

async function build() {
    const template = await readFile(join(siteDir, 'template.html'), 'utf8');
    const source = JSON.parse(await readFile(join(contentDir, `${SOURCE}.json`), 'utf8'));
    const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;

    const available = (await readdir(contentDir))
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.slice(0, -'.json'.length));
    const unknown = available.filter((code) => !selected.some((locale) => locale.code === code));
    if (unknown.length) {
        throw new Error(`site/content holds locales the build does not list: ${unknown.join(', ')}`);
    }
    const absent = selected.filter((locale) => !available.includes(locale.code));
    if (absent.length) {
        throw new Error(`site/content is missing: ${absent.map((locale) => locale.code).join(', ')}`);
    }

    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });

    for (const locale of selected) {
        const deck = JSON.parse(await readFile(join(contentDir, `${locale.code}.json`), 'utf8'));
        if (locale.code !== SOURCE) {
            checkKeys(source, deck, locale.code);
        }

        // The status word is written once per deck, not on every row.
        const rows = deck.features.rows.map((row) => ({
            ...row,
            statusWord: deck.features[row.status] ?? row.status,
        }));

        // Every leaf of the deck as a path, so a list item can reach a key that
        // sits outside its own slice ({{features.rows.6.name}} from the install
        // section, for instance).
        const leaves = flatten(deck);
        for (const [path, value] of Object.entries(leaves)) {
            if (path.endsWith(']')) {
                continue;
            }
            leaves[path] = value;
        }

        const context = {
            ...deck,
            ...leaves,
            features: { ...deck.features, rows },
            version,
            lang: locale.htmlLang,
            dir: locale.dir,
            langName: locale.name,
            canonical: href(locale.code),
            root: locale.code === SOURCE ? './' : '../',
            siteUrl: SITE_URL,
            repoUrl: REPO_URL,
            docsUrl: `${REPO_URL}/tree/main/docs`,
            releaseUrl: installerUrl(version),
            releasesUrl: `${REPO_URL}/releases`,
            changelogUrl: `${REPO_URL}/blob/main/CHANGELOG.md`,
            limitationsUrl: `${REPO_URL}/blob/main/docs/LIMITATIONS.md`,
            compatUrl: `${REPO_URL}/blob/main/docs/ST-COMPATIBILITY.md`,
            securityUrl: `${REPO_URL}/blob/main/docs/SECURITY.md`,
            licenseUrl: `${REPO_URL}/blob/main/LICENSE`,
            jsonld: jsonLd(deck, locale.code, version),
            alternates: LOCALES.map((other) => ({
                code: other.code,
                url: href(other.code),
            })),
            languages: LOCALES.map((other) => ({
                code: other.code,
                name: other.name,
                url: relativeLink(locale.code, other.code),
                selected: String(other.code === locale.code),
            })),
            demoData: JSON.stringify({
                opening: deck.opening,
                replies: deck.replies,
                userLine: deck.demo.userLine,
                character: deck.demo.character,
                characterInitials: deck.demo.characterInitials,
                youInitials: deck.demo.youInitials,
                you: deck.demo.you,
                copied: deck.install.copied,
            }).replace(/</g, '\\u003c'),
        };

        const html = render(template, context);
        const leftovers = html.match(/\{\{[^}]+\}\}/g);
        if (leftovers) {
            throw new Error(`${locale.code} left placeholders unresolved: ${[...new Set(leftovers)].join(' ')}`);
        }
        const target = locale.code === SOURCE ? outDir : join(outDir, locale.code);
        await mkdir(target, { recursive: true });
        await writeFile(join(target, 'index.html'), html, 'utf8');
        console.log(`  ${locale.code.padEnd(6)} ${locale.name}`);
    }

    await copyStatic();
    await checkOutput();
    console.log(`Built ${selected.length} locales into site/dist`);
}

async function copyStatic() {
    for (const file of ['styles.css', 'main.js']) {
        await copyFile(join(siteDir, file), join(outDir, file));
    }
    await mkdir(join(outDir, 'assets'), { recursive: true });
    for (const file of await readdir(join(siteDir, 'assets'))) {
        await copyFile(join(siteDir, 'assets', file), join(outDir, 'assets', file));
    }

    await writeFile(join(outDir, '.nojekyll'), '', 'utf8');
    await writeFile(
        join(outDir, 'robots.txt'),
        ['User-agent: *', 'Allow: /', '', `Sitemap: ${SITE_URL}/sitemap.xml`, ''].join('\n'),
        'utf8',
    );

    const urls = LOCALES.map((locale) => {
        const alternates = LOCALES.map(
            (other) => `    <xhtml:link rel="alternate" hreflang="${other.code}" href="${href(other.code)}"/>`,
        ).join('\n');
        return [
            '  <url>',
            `    <loc>${href(locale.code)}</loc>`,
            '    <changefreq>weekly</changefreq>',
            '    <priority>1.0</priority>',
            alternates,
            '  </url>',
        ].join('\n');
    }).join('\n');
    await writeFile(
        join(outDir, 'sitemap.xml'),
        [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"',
            '        xmlns:xhtml="http://www.w3.org/1999/xhtml">',
            urls,
            '</urlset>',
            '',
        ].join('\n'),
        'utf8',
    );
}

/* ── Link checks ─────────────────────────────────────────────────────── */

// A relative link is the one thing the checks above cannot see: it type-checks
// as a string. Every one has to resolve to a file this build wrote, and to stay
// inside the site — `/CatCup-Tavern/` is a project path, so one `../` too many
// silently leaves it and lands on whatever else the account hosts.
function pageDirectory(code) {
    return code === SOURCE ? [] : [code];
}

function resolveRelative(code, link) {
    const path = link.split('#')[0].split('?')[0];
    if (!path) {
        return null;
    }
    const stack = pageDirectory(code).slice();
    for (const segment of path.split('/')) {
        if (segment === '' || segment === '.') {
            continue;
        }
        if (segment === '..') {
            if (stack.length === 0) {
                return { escapes: true, target: '' };
            }
            stack.pop();
            continue;
        }
        stack.push(segment);
    }
    return { escapes: false, target: stack.join('/') };
}

function checkLinks(html, code, folder = outDir) {
    const links = [...html.matchAll(/(?:href|src)="([^"]*)"/g)].map((match) => match[1]);
    const bad = [];
    for (const link of links) {
        if (/^(https?:|mailto:|#|\/\/)/.test(link)) {
            continue;
        }
        const resolved = resolveRelative(code, link);
        if (!resolved) {
            continue;
        }
        if (resolved.escapes) {
            bad.push(`${link} leaves the site (from /${pageDirectory(code).join('/') || ''})`);
            continue;
        }
        // `./` and `zh-CN/` address a folder; everything else is a file.
        const isFolder = link.endsWith('/') || resolved.target === '';
        if (isFolder) {
            const page = resolved.target ? `${resolved.target}/index.html` : 'index.html';
            if (!existsSync(join(folder, page))) {
                bad.push(`${link} has no ${page}`);
            }
        } else if (!existsSync(join(folder, resolved.target))) {
            bad.push(`${link} has no ${resolved.target}`);
        }
    }
    if (bad.length) {
        throw new Error(`page ${code} has broken links:\n  ${bad.join('\n  ')}`);
    }
}

/** The same check over the pages, once the assets exist beside them. */
async function checkOutput(folder = outDir) {
    const pages = [SOURCE, ...LOCALES.map((locale) => locale.code).filter((code) => code !== SOURCE)];
    for (const code of pages) {
        const file = code === SOURCE ? join(folder, 'index.html') : join(folder, code, 'index.html');
        if (!existsSync(file)) {
            continue;
        }
        checkLinks(await readFile(file, 'utf8'), code, folder);
    }
}

export { checkOutput };

// `node scripts/build-site.mjs` builds; an import (the preview server) only
// takes the build() export.
const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

try {
    if (invoked) {
        await build();
    }
} catch (error) {
    console.error(`\nbuild-site: ${error.message}\n`);
    process.exitCode = 1;
}
