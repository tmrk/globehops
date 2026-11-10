import { LOCALES, localeInfo, type Locale } from './locales.ts';
import { localizedPath } from './detect.ts';
import { metadata } from './metadata.ts';
import { DEFAULT_BASE_URL } from '../agent/contract.ts';
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/** Build-time HTML only: each Pages directory is directly crawlable without JavaScript. */
export function localizedHtml(html: string, base: string, locale: Locale | null): string {
  const language = locale ?? 'en';
  const page = metadata[language];
  const origin = new URL(DEFAULT_BASE_URL).origin;
  const address = origin + localizedPath(base, locale);
  let result = html
    .replace(/<html lang="[^"]*">/, `<html lang="${language}">`)
    .replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(page.title)}</title>`);
  for (const [attribute, key, value] of [
    ['name', 'description', page.description],
    ['property', 'og:title', page.title],
    ['property', 'og:description', page.socialDescription],
    ['property', 'og:url', address],
    ['property', 'og:image:alt', page.imageAlt],
    ['property', 'og:image', `${origin}${localizedPath(base, null)}og-image.png`],
  ])
    result = result.replace(
      new RegExp(`<meta\\s+${attribute}="${key}"\\s+content="[^"]*"\\s*/?>`),
      `<meta ${attribute}="${key}" content="${escapeHtml(value)}" />`,
    );
  if (language !== 'en') {
    result = result.replace('title="Agent and LLM guide"', `title="${escapeHtml(page.guide)}"`);
  }
  result = result.replace(
    /<noscript[\s\S]*?<\/noscript\s*>/,
    `<noscript><p style="color: #eee; font-family: system-ui; padding: 24px">${escapeHtml(page.noscript)} <a href="${localizedPath(base, null)}llms.txt">${escapeHtml(page.guide)}</a>.</p></noscript>`,
  );
  result = result.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/, (_whole, raw: string) => {
    const data = JSON.parse(raw) as Record<string, unknown>;
    return `<script type="application/ld+json">${JSON.stringify({
      ...data,
      url: address,
      description: page.description,
      inLanguage: localeInfo[language].tag,
      potentialAction: {
        '@type': 'ViewAction',
        target: { '@type': 'EntryPoint', urlTemplate: `${origin}${localizedPath(base, null)}?route={route}` },
      },
    }).replace(/</g, '\\u003c')}</script>`;
  });
  const links = LOCALES.map(
    (lang) =>
      `<link rel="alternate" hreflang="${localeInfo[lang].hreflang}" href="${origin}${localizedPath(base, lang)}" />`,
  ).join('\n');
  return result.replace(
    '</head>',
    `<meta property="og:locale" content="${localeInfo[language].og}" />\n<link rel="canonical" href="${address}" />\n${links}\n<link rel="alternate" hreflang="x-default" href="${origin}${localizedPath(base, null)}" />\n</head>`,
  );
}

/** The host's static 404 page: one line per language, each linking to that language's app page. */
export function notFoundHtml(base: string): string {
  const lines = LOCALES.map(
    (lang) =>
      `<p lang="${lang}">${escapeHtml(metadata[lang].notFound)} <a href="${localizedPath(base, lang)}">${escapeHtml(metadata[lang].open)}</a></p>`,
  ).join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<meta name="theme-color" content="#05080f" />
<title>404 · GlobeHops</title>
<link rel="icon" href="${localizedPath(base, null)}favicon.svg" type="image/svg+xml" />
<style>
:root { color-scheme: dark; }
body { margin: 0; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; background: #04060c; color: #e8ecf4; font: 17px/1.6 system-ui, sans-serif; text-align: center; }
main { padding: 24px 16px; }
h1 { margin: 0 0 12px; font-size: 20px; font-weight: 600; letter-spacing: 0.04em; }
p { margin: 4px 0; color: #a9b2c3; }
a { color: #ffc23d; }
</style>
</head>
<body>
<main>
<h1>GlobeHops</h1>
${lines}
</main>
</body>
</html>
`;
}
