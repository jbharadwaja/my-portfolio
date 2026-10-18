import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const count = (re) => (html.match(re) || []).length;
const cards = Object.fromEntries([...html.matchAll(/<article class="card[^"]*"[\s\S]*?<\/article>/g)]
  .map((m) => [m[0].match(/data-index="([^"]+)"/)[1], m[0]]));
const openTag = (id) => cards[id].match(/^<article[^>]*>/)[0];
const attr = (id, name) => {
  const m = openTag(id).match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`));
  return m ? (m[1] ?? m[2]).replaceAll('&quot;', '"') : null;
};
const summary = (id) => cards[id].match(/<p class="card-summary">([^<]*)<\/p>/)?.[1];
const links = (id) => [...cards[id].matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);
const REPO = 'https://github.com/jbharadwaja/Data_projects_TripleTen';
test('one h1 with the name', () => {
  assert.equal(count(/<h1[\s>]/g), 1);
  assert.match(html, /<h1[^>]*>[\s\S]*JULIAN[\s\S]*BHARADWAJA[\s\S]*<\/h1>/);
});
test('sections in order with HUD labels', () => {
  const ids = [...html.matchAll(/<section[^>]*id="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids, ['top', 'encoder', 'training', 'work', 'route', 'about', 'contact']);
  const huds = [...html.matchAll(/data-hud="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(huds, ['01 / 07  HERO', '02 / 07  ENCODER', '03 / 07  TRAINING', '04 / 07  EXPERIMENTS', '05 / 07  ROUTE', '06 / 07  ABOUT', '07 / 07  CONTACT']);
  assert.equal(count(/<h2[\s>]/g), 6);
});
test('eight cards with verdicts and machine values', () => {
  const verdicts = [...html.matchAll(/<article class="card[^"]*"[^>]*data-verdict="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(verdicts, ['BEAT TARGET', 'LEAKAGE FIXED', 'NEAR-TIE', 'LINEAR WON', 'LOW RISK', 'JUST CLEARED', 'IN PRODUCTION', 'ADOPTED']);
  assert.match(html, /data-index="EXP_01"[^>]*data-metric="0.90" data-compare="0.85" data-better="higher"/);
  assert.match(html, /data-index="EXP_03"[^>]*data-metric="9.41" data-compare="9.44" data-better="lower"/);
  assert.match(html, /data-index="EXP_04"[^>]*data-metric="34.5" data-compare="48" data-better="lower"/);
  assert.equal(count(/tabindex="0"/g), 8);
});
test('route stops carry coordinates', () => {
  const stops = [...html.matchAll(/data-stop="(\d)" data-lat="([-\d.]+)" data-lon="([-\d.]+)"/g)].map((m) => [m[2], m[3]]);
  assert.deepEqual(stops, [['14.08', '100.61'], ['35.68', '139.69'], ['37.57', '126.98'], ['33.75', '-117.83']]);
});
test('about photo is a real image with alt text', () => {
  assert.match(html, /<img[^>]*src="assets\/img\/portrait-full.webp"[^>]*alt="Julian Bharadwaja at a window overlooking the Grand Canyon"/);
});
test('CV links ship in the LinkedIn fallback state', () => {
  assert.equal(count(/class="js-cv[^"]*"[^>]*href="https:\/\/www.linkedin.com\/in\/julian-bharadwaja\/"/g), 3);
  assert.doesNotMatch(html, /assets\/cv\//);
});
test('no reference-site leftovers', () => {
  assert.doesNotMatch(html, /02d2e3|Oswald|Space Grotesk|Antonelli/i);
});
test('EXP_06 is the Beta Bank churn card', () => {
  assert.match(html, /data-index="EXP_06" data-verdict="JUST CLEARED" data-metric="0.609" data-compare="0.59" data-better="higher"/);
  assert.match(cards.EXP_06, /<h3 class="card-title" id="exp-06-title">Beta Bank customer churn<\/h3>/);
  assert.match(cards.EXP_06, /<ul class="chips"><li class="chip mono">Python<\/li><li class="chip mono">scikit-learn<\/li><li class="chip mono">random forest<\/li><li class="chip mono">class imbalance<\/li><\/ul>/);
  assert.match(cards.EXP_06, /<span class="card-metric-label">F1<\/span> <span class="card-metric-value">0.609<\/span>/);
  assert.match(cards.EXP_06, /<p class="card-compare mono">target 0.59 · AUC-ROC 0.859<\/p>/);
  assert.match(cards.EXP_06, /<span class="stamp mono">JUST CLEARED<\/span>/);
});
test('series charts carry their data in data-* attributes', () => {
  assert.deepEqual(JSON.parse(attr('EXP_02', 'data-series')),
    [['mean baseline', 4567], ['linear', 2839], ['decision tree', 1913], ['random forest', 1638], ['CatBoost', 1569], ['XGBoost', 1556], ['LightGBM', 1560, 'chosen']]);
  assert.deepEqual(JSON.parse(attr('EXP_05', 'data-series')),
    [['Region 0', 2.0], ['Region 1', 0.1, 'chosen'], ['Region 2', 2.5]]);
  for (const id of ['EXP_02', 'EXP_05']) {
    assert.equal(attr(id, 'data-better'), 'lower');
    assert.ok(attr(id, 'data-series-label'), `${id} has a series label`);
  }
  assert.equal(attr('EXP_05', 'data-limit'), '2.5');
});
test('compared-with text matches the spec table', () => {
  const compare = (id) => cards[id].match(/<p class="card-compare mono">([^<]*)<\/p>/)[1];
  assert.equal(compare('EXP_02'), 'mean-price baseline €4,567 (validation) · 6 model types compared');
  assert.equal(compare('EXP_05'), '0.1% risk of loss (limit 2.5%)');
  assert.equal(compare('EXP_06'), 'target 0.59 · AUC-ROC 0.859');
  assert.match(cards.EXP_04, /<li class="chip mono">time series<\/li><li class="chip mono">linear regression<\/li><li class="chip mono">LightGBM<\/li><li class="chip mono">CatBoost<\/li>/);
});
test('card links are the verified deep links; EXP_01 and the field cards have none', () => {
  assert.deepEqual(links('EXP_02'), [`${REPO}/tree/main/08_rusty_bargain_car_prices`]);
  assert.deepEqual(links('EXP_03'), [`${REPO}/tree/main/07_gold_recovery_prediction`]);
  assert.deepEqual(links('EXP_04'), [`${REPO}/tree/main/09_sweet_lift_taxi_forecasting`]);
  assert.deepEqual(links('EXP_05'), [`${REPO}/tree/main/06_oilygiant_well_location`]);
  assert.deepEqual(links('EXP_06'), [`${REPO}/tree/main/05_beta_bank_churn`]);
  assert.doesNotMatch(cards.EXP_01, /<a /);
  assert.doesNotMatch(cards.FIELD_01, /<a /);
  assert.doesNotMatch(cards.FIELD_02, /<a /);
});
test('every card has a summary after its chips', () => {
  assert.equal(count(/class="card-summary"/g), 8);
  for (const id of Object.keys(cards)) assert.match(cards[id], /<\/ul>\s*<p class="card-summary">[^<]+<\/p>\s*<p class="card-metric/, `${id} summary position`);
  assert.equal(summary('EXP_01'), 'Lemmatized IMDB reviews with spaCy, built TF-IDF features and trained logistic regression.');
  assert.equal(summary('EXP_02'), "Predicts a used car's market value from 301,847 cleaned listings. LightGBM chosen for accuracy, training time and prediction speed.");
  assert.equal(summary('EXP_03'), 'Predicts gold recovery at two purification stages from hourly process data. Beat the median baseline on the rougher stage, not the final.');
  assert.equal(summary('EXP_04'), 'Forecasts next-hour airport taxi orders from lag and rolling-mean features. Linear regression beat the tree models.');
  assert.equal(summary('EXP_05'), 'Picks one of three regions for 200 new wells: linear regression per region, then 1,000 bootstrap samples for profit and risk.');
  assert.equal(summary('FIELD_01'), 'Margin analysis of transaction and customer-mix data; weekly KPI tracking replaced manual reports.');
  assert.equal(summary('FIELD_02'), 'Analyzed participation data across 20+ programs; the findings shaped program changes.');
});
test('EXP_06 summary is short and comes from the churn README', () => {
  const text = summary('EXP_06');
  assert.ok(text.length > 0 && text.length <= 150, `length ${text.length}`);
  assert.match(text, /churn|leave/i);
  assert.match(text, /random forest/i);
  assert.match(text, /Tenure/);
});
test('a "more notebooks" link follows the rail, outside it', () => {
  assert.match(html, /<a class="rail-more mono" href="https:\/\/github.com\/jbharadwaja\/Data_projects_TripleTen"[^>]*>More notebooks on GitHub →<\/a>/);
  const between = html.slice(html.lastIndexOf('</article>') + '</article>'.length, html.indexOf('class="rail-more'));
  assert.match(between, /^\s*<\/div>\s*<\/div>\s*<a $/, 'rail and rail-viewport are closed before the link');
  assert.equal(count(/class="rail-more/g), 1);
});
test('about: languages, skills and certifications', () => {
  assert.match(html, /<p class="about-bio">[^<]*I speak English, Japanese and Burmese\.[^<]*<\/p>/);
  const skills = html.match(/<div class="skills">[\s\S]*?<ul class="certs"/)?.[0] ?? '';
  for (const s of ['XGBoost', 'statsmodels', 'Seaborn', 'A/B testing', 'Tableau', 'Docker', 'FastAPI']) assert.ok(skills.includes(s), `skills include ${s}`);
  const certs = html.match(/<ul class="certs">([\s\S]*?)<\/ul>/)?.[1] ?? '';
  for (const c of ['Python Master', 'Data Visualization Master', 'SQL Data Specialist', 'Statistics Foundations']) assert.ok(certs.includes(c), `certs include ${c}`);
});
test('no retired project copy', () => {
  assert.doesNotMatch(html, /SHINYOROI|PyTrends|SHIPPED/);
});

// Ruling R19: markup the scripts and the layout rely on
test('the About plate image carries its intrinsic size (no layout shift as it loads)', () => {
  assert.match(html, /<img class="plate-img" src="assets\/img\/portrait-full\.webp" width="788" height="985" /);
});
test('#sheet and #console are hidden modal dialogs', () => {
  for (const id of ['sheet', 'console']) {
    const tag = html.match(new RegExp(`<div [^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    assert.ok(tag, `#${id} exists`);
    assert.match(tag, /\srole="dialog"/, `#${id} role`);
    assert.match(tag, /\saria-modal="true"/, `#${id} aria-modal`);
    assert.match(tag, /\shidden[\s>]/, `#${id} hidden`);
    assert.match(tag, /\saria-label="[^"]+"/, `#${id} is named`);
  }
});
test('the CV links read [ CV ↗ ] in the header and CV on LinkedIn ↗ in the hero and the sign-off', () => {
  const cv = [...html.matchAll(/<a class="js-cv[^"]*"[^>]*data-cv="([a-z]+)"[^>]*>([^<]*)<\/a>/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(cv, [['header', '[ CV ↗ ]'], ['hero', 'CV on LinkedIn ↗'], ['signoff', 'CV on LinkedIn ↗']]);
});
