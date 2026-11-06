import { chromium } from '@playwright/test';
const ID = 'G-MN3ZVQ1KP4';
const variants = {
  V5_final: `gtag('consent','default',{analytics_storage:'granted',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});gtag('set',Object.assign({},P,{entry:'link'}));gtag('js',new Date());gtag('config','${ID}',{allow_google_signals:false,allow_ad_personalization_signals:false});setTimeout(function(){history.replaceState(null,'','?route=XYZ-ABC');document.title='XYZ';gtag('event','share',{method:'copy_link'})},2500);`,
};
const browser = await chromium.launch();
for (const [name, code] of Object.entries(variants)) {
  const ctx = await browser.newContext();
  await ctx.route('https://tmrk.github.io/gtest/**', (route) => route.fulfill({ contentType: 'text/html', body: `<!doctype html><title>CPH → LHR · GlobeHops</title><body>x<script>window.dataLayer=[];function gtag(){dataLayer.push(arguments)};var P={page_location:'https://tmrk.github.io/gtest/',page_title:'GlobeHops'};${code}</script><script async src="https://www.googletagmanager.com/gtag/js?id=${ID}"></script></body>` }));
  await ctx.route(/google-analytics\.com|\/g\/collect/, (route) => route.abort());
  const page = await ctx.newPage();
  const hits = [];
  page.on('request', (r) => {
    if (!/collect/.test(r.url())) return;
    const q = new URL(r.url()).searchParams;
    const lines = [q, ...(r.postData() ?? '').split('\n').filter(Boolean).map((l) => new URLSearchParams(l))];
    hits.push(lines.map((b) => ['en', 'dl', 'dt', 'ep.entry', 'ep.method', 'ngs', 'npa'].filter((k) => b.has(k)).map((k) => `${k}=${b.get(k)}`).join(' ')).filter(Boolean).join(' || '));
  });
  await page.goto('https://tmrk.github.io/gtest/?route=CPH-LHR');
  await page.waitForTimeout(5000);
  console.log(name, JSON.stringify(hits, null, 0));
  await ctx.close();
}
await browser.close();
