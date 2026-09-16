"""Browser QA for the 47-case clinical review workspace (Edge + Playwright)."""
import copy
import json
import os
import re
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ENTRY = os.environ.get('COT_SITE_URL', (ROOT / 'docs/index.html').as_uri())
ARTIFACTS = ROOT / ('.runtime/qa_live_review' if os.environ.get('COT_SITE_URL') else '.runtime/qa_review')
CJK = re.compile(r'[\u3400-\u9fff\U00020000-\U000323af]')
FIELDS = ('question', 'caption', 'think', 'answer')
ARTIFACTS.mkdir(parents=True, exist_ok=True)


def state_of(page):
    return page.evaluate('JSON.parse(JSON.stringify(state))')


def split_reasoning(text):
    tail_match = re.search(r'(?m)^(?:Differential diagnosis comparison:|Diagnostic chain:|Limitations:)', text)
    body = text[:tail_match.start()] if tail_match else text
    headings = list(re.finditer(r'(?m)^(Differential diagnosis comparison:|Diagnostic chain:|Limitations:)', text))
    sections = {name: '' for name in ('differential', 'diagnosticChain', 'limitations')}
    labels = {'Differential diagnosis comparison:': 'differential', 'Diagnostic chain:': 'diagnosticChain', 'Limitations:': 'limitations'}
    for i, heading in enumerate(headings):
        sections[labels[heading.group(1)]] = text[heading.start():headings[i + 1].start() if i + 1 < len(headings) else len(text)].strip()
    markers = list(re.finditer(r'(?m)^\s*(\d+)\.\s+', body))
    lead = body[:markers[0].start()].strip() if markers else body.strip()
    steps = [body[m.end():markers[i + 1].start() if i + 1 < len(markers) else len(body)].strip()
             for i, m in enumerate(markers)]
    return lead, steps, sections


def assert_anonymous(obj):
    if isinstance(obj, dict):
        assert not {'reviewer', 'specialty', 'doctorName', 'reviewerId'} & set(obj)
        for value in obj.values():
            assert_anonymous(value)
    elif isinstance(obj, list):
        for value in obj:
            assert_anonymous(value)


def assert_english(page):
    interface = page.evaluate("""() => {
        const node = document.body.cloneNode(true);
        node.querySelectorAll('script,style').forEach(el => el.remove());
        return node.textContent + Array.from(node.querySelectorAll('*')).flatMap(el =>
            ['aria-label','title','placeholder','alt'].map(a => el.getAttribute(a) || '')).join(' ');
    }""")
    assert not CJK.search(interface), 'Chinese remains in rendered interface'
    assert page.locator('[data-field="reviewer"],[data-field="specialty"],input[name="reviewer"]').count() == 0
    assert page.locator('html').get_attribute('lang') == 'en'


def download_json(page, selector):
    locator = page.locator(selector)
    locator.evaluate("(el) => { const menu = el.closest('details'); if(menu) menu.open = true; }")
    with page.expect_download() as downloaded:
        locator.click()
    return json.loads(Path(downloaded.value.path()).read_text(encoding='utf-8'))


def import_json(page, payload):
    page.locator('#toast').evaluate('(el) => el.textContent = ""')
    page.locator('#restore').set_input_files({
        'name': 'review.json', 'mimeType': 'application/json',
        'buffer': json.dumps(payload).encode(),
    })
    expect(page.locator('#toast')).to_contain_text('Review restored.')


with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge')
    context = browser.new_context(accept_downloads=True, viewport={'width': 1440, 'height': 1000})
    js_errors, request_failures, dialogs = [], [], []
    context.on('page', lambda page: page.on('pageerror', lambda error: js_errors.append(str(error))))
    context.on('requestfailed', lambda request: request_failures.append(
        {'url': request.url, 'failure': request.failure}))
    page = context.new_page()
    page.set_default_timeout(15000 if os.environ.get('COT_SITE_URL') else 7000)
    page.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
    page.goto(ENTRY)
    data = page.evaluate('window.COT_DATA')
    source_js = (ROOT / 'docs/data.js').read_text(encoding='utf-8')
    expected_data = json.loads(source_js[len('window.COT_DATA = '):].strip().removesuffix(';'))
    assert data == expected_data, 'Published case data differs from the local data artifact'
    cases = data['cases']
    assert len(cases) == len({case['id'] for case in cases}) == 47
    assert sum(len(case['images']) for case in cases) == 95
    english_cases = [case for case in cases if case.get('english')]
    assert len(english_cases) == 3
    assert {case['id'] for case in cases if not case['images']} == {'PMC6738723', 'PMC11297549'}
    assert not CJK.search(json.dumps(data, ensure_ascii=False))
    expect(page.locator('#caseSelect option')).to_have_count(47)
    assert page.locator('#caseSelect option').evaluate_all('(els) => els.map(el => el.value)') == [c['id'] for c in cases]

    def route(case, version='original'):
        fragment = '#case=' + case['id'] + ('&version=english' if version == 'english' else '')
        page.evaluate('(fragment) => { location.hash = fragment; }', fragment)
        expect(page.locator('#sampleLabel')).to_have_text(case['id'])
        expect(page.locator('#versionSelect')).to_have_value(version)
        current = case['english'] if version == 'english' else case
        assert page.locator('#caseTitle').text_content() == case['title']
        for field in ('question', 'caption', 'answer'):
            selector = '#questionText' if field == 'question' else '#' + field
            assert page.locator(selector).text_content() == current[field], (case['id'], field, version)
        lead, steps, sections = split_reasoning(current['think'])
        expect(page.locator('#steps .step')).to_have_count(len(steps))
        for index, raw in enumerate(steps):
            step = page.locator('#steps .step').nth(index)
            body = step.locator('.step-body').text_content()
            assert body == raw or step.locator('h3').text_content() + ': ' + body == raw, (case['id'], version, index)
        assert page.locator('#reasoningLead').text_content().strip() == lead, (case['id'], version, 'lead')
        assert page.locator('#reasoningTail').text_content().strip() == ''
        for section, expected in sections.items():
            assert page.locator('#' + section).text_content() == expected, (case['id'], version, section)
        assert page.evaluate('sample.think') == current['think']
        assert page.locator('#images img').evaluate_all('(els) => els.map(el => el.getAttribute("src"))') == [im['src'] for im in current['images']]
        expect(page.locator('.dimension')).to_have_count(7)
        assert not CJK.search(page.locator('body').inner_text())
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), (case['id'], page.viewport_size)
        if not current['images']:
            assert 'text-only' in page.locator('#evidenceNote').inner_text().lower()
        return current

    for case in cases:
        route(case)
    for case in english_cases:
        route(case, 'english')
        page.reload()
        expect(page.locator('#sampleLabel')).to_have_text(case['id'])
        expect(page.locator('#versionSelect')).to_have_value('english')
        assert page.locator('#answer').text_content() == case['english']['answer']
    print('PASS: all 47 cases and 3 variants, exact fields/dynamic steps/tails, images and deep-link reloads', flush=True)

    decoded = page.evaluate("""async () => {
        const refs = window.COT_DATA.cases.flatMap(c => [...c.images, ...(c.english?.images || [])]);
        return Promise.all(refs.map(im => new Promise(resolve => {
            const image = new Image();
            image.onload = () => resolve({src:im.src,ok:image.naturalWidth===im.width && image.naturalHeight===im.height});
            image.onerror = () => resolve({src:im.src,ok:false});
            image.src=im.src;
        })));
    }""")
    assert len(decoded) == 104 and len({im['src'] for im in decoded}) == 96
    assert all(im['ok'] for im in decoded), [im for im in decoded if not im['ok']]

    # The draft collection can be exported before any review is completed.
    empty_collection = download_json(page, '#exportAll')
    assert_anonymous(empty_collection)
    assert empty_collection['type'] == 'review_collection' and empty_collection['caseCount'] == 47
    assert len(empty_collection['reviews']) == 50
    assert all(review['status'] == 'not_started' for review in empty_collection['reviews'])
    page.locator('#caseSearch').fill(cases[10]['id'])
    expect(page.locator('#caseSelect option')).to_have_count(1)
    assert page.locator('#caseSelect option').first.get_attribute('value') == cases[10]['id']
    page.locator('#caseSearch').fill('QA-no-match-97c4d2')
    assert page.locator('#caseSelect option').count() <= 1
    expect(page.locator('#caseSelect')).to_be_disabled()
    page.locator('#caseSearch').fill('')
    expect(page.locator('#caseSelect option')).to_have_count(47)
    page.locator('#caseSelect').select_option(cases[0]['id'])
    expect(page.locator('#sampleLabel')).to_have_text(cases[0]['id'])
    expect(page.locator('#prevCase')).to_be_disabled()
    page.locator('#nextCase').click()
    expect(page.locator('#sampleLabel')).to_have_text(cases[1]['id'])
    page.locator('#prevCase').click()
    expect(page.locator('#sampleLabel')).to_have_text(cases[0]['id'])
    route(cases[-1])
    expect(page.locator('#nextCase')).to_be_disabled()

    review_case = next(case for case in english_cases if case['id'] != cases[0]['id'])
    current = route(review_case)
    page.locator('#export').click()
    expect(page.locator('#validation')).to_be_visible()
    expect(page.locator('#validation li')).to_have_count(8)
    assert 'reviewer' not in page.locator('#validation').inner_text().lower()
    page.locator('#validation a').first.click()
    expect(page.locator('#sampleLabel')).to_have_text(review_case['id'])
    for index in range(7):
        page.locator(f'input[name="score{index}"][value="4"]').check()
    page.locator('input[name="score0"][value="UA"]').check()
    assert page.locator('#note0').evaluate('(el) => el.open')
    expect(page.locator('#comment0')).to_be_focused()
    page.locator('[name="recommendation"][value="Revise"]').check()
    page.locator('#export').click()
    expect(page.locator('#validation li')).to_have_count(2)
    assert 'Evidence Grounding' in page.locator('#validation').inner_text()
    note = 'Missing original clinical evidence. Literal test: </script><tag>'
    page.locator('#comment0').fill(note)
    page.locator('#overallReason').fill('Review the unsupported step.')
    page.locator('[data-step="0"]').click()
    expect(page.locator('.issue')).to_have_count(1)
    assert split_reasoning(current['think'])[1][0] in page.locator('[data-prop="quote"]').input_value()
    page.locator('#export').click()
    assert 'issue description' in page.locator('#validation').inner_text()
    page.locator('[data-prop="problem"]').fill('This statement needs verification against the source material.')
    page.locator('[data-prop="correction"]').fill('Retain the uncertainty until the original report is reviewed.')
    original_key = page.evaluate('key')
    original_state = state_of(page)
    single = download_json(page, '#export')
    assert single['sampleId'] == review_case['id']
    assert single['schemaVersion'] == '2.0' and single['datasetVersion'] == data['version']
    assert single['contentVersion'] == 'original'
    assert all(single['sample'][field] == current[field] for field in FIELDS)
    assert single['status'] == 'completed'
    assert len(single['dimensions']) == 7
    assert single['dimensions'][0]['score'] is None and single['dimensions'][0]['unableToAssess'] is True
    assert all(dim['score'] == 4 for dim in single['dimensions'][1:])
    assert_anonymous(single)
    assert single['state']['comments']['0'] == note

    # The alternate content version must never inherit the current version's ratings.
    page.locator('#versionSelect').select_option('english')
    expect(page.locator('#versionSelect')).to_have_value('english')
    assert page.evaluate('key') != original_key
    assert not state_of(page)['scores'] and not state_of(page)['issues']
    page.locator('input[name="score0"][value="2"]').check()
    page.locator('#note0').evaluate('(el) => el.open = true')
    page.locator('#comment0').fill('Separate alternate-version note')
    english_key = page.evaluate('key')
    other_case = next(case for case in cases if case['id'] != review_case['id'])
    page.locator('#caseSelect').select_option(other_case['id'])
    expect(page.locator('#sampleLabel')).to_have_text(other_case['id'])
    assert page.evaluate('key') not in (original_key, english_key)
    assert not state_of(page)['scores'] and not state_of(page)['issues']
    page.locator('input[name="score1"][value="5"]').check()
    page.reload()
    expect(page.locator('input[name="score1"][value="5"]')).to_be_checked()
    route(review_case)
    expect(page.locator('input[name="score0"][value="UA"]')).to_be_checked()
    assert page.locator('#comment0').input_value() == note
    expect(page.locator('.issue')).to_have_count(1)
    route(review_case, 'english')
    expect(page.locator('input[name="score0"][value="2"]')).to_be_checked()
    assert page.locator('#comment0').input_value() == 'Separate alternate-version note'
    page.reload()
    expect(page.locator('input[name="score0"][value="2"]')).to_be_checked()
    route(review_case)

    # Single-review JSON is authoritative only after an explicit confirmation.
    page.locator('#overallReason').fill('Changed draft')
    import_json(page, single)
    expect(page.locator('#overallReason')).to_have_value(single['state']['fields']['overallReason'])
    assert dialogs, 'Import did not request confirmation'
    assert page.locator('#comment0').input_value() == note
    legacy = copy.deepcopy(single)
    legacy['state']['fields'].update(reviewer='QA-LEGACY-IDENTITY', specialty='QA-LEGACY-SPECIALTY')
    import_json(page, legacy)
    expect(page.locator('#overallReason')).to_have_value(single['state']['fields']['overallReason'])
    assert_anonymous(state_of(page))
    assert 'QA-LEGACY-IDENTITY' not in json.dumps(download_json(page, '#export'))
    collection = download_json(page, '#exportAll')
    assert_anonymous(collection)
    assert note in json.dumps(collection)
    assert 'Separate alternate-version note' in json.dumps(collection)
    # Restore the exported collection in a clean browser context, proving portability.
    fresh_context = browser.new_context(accept_downloads=True, viewport={'width':1440,'height':1000})
    fresh = fresh_context.new_page()
    fresh.on('pageerror', lambda error: js_errors.append(str(error)))
    fresh.on('dialog', lambda dialog: (dialogs.append(dialog.message), dialog.accept()))
    fresh.goto(ENTRY + '#case=' + review_case['id'])
    import_json(fresh, collection)
    expect(fresh.locator('#comment0')).to_have_value(note)
    fresh.locator('#versionSelect').select_option('english')
    expect(fresh.locator('#comment0')).to_have_value('Separate alternate-version note')
    assert_anonymous(state_of(fresh))
    fresh_context.close()
    print('PASS: seven dimensions/UA, recommendation, annotations, isolated drafts, confirmed JSON export/import', flush=True)

    # No stale source data, identity widgets, or layout regression across all views.
    page.locator('[name="recommendation"][value="Keep"]').check()
    page.locator('#overallReason').fill('')
    assert download_json(page, '#export')['state']['fields']['recommendation'] == 'Keep'
    page.set_viewport_size({'width':390,'height':844})
    for case in cases:
        route(case)
    for case in english_cases:
        route(case, 'english')
    assert_english(page)
    assert not js_errors, js_errors
    unexpected_failures = [r for r in request_failures if 'ERR_ABORTED' not in r['failure']]
    assert not unexpected_failures, unexpected_failures
    result = {
        'status':'passed', 'browser':'Microsoft Edge', 'entry':ENTRY,
        'cases':47,'contentVersions':50,'originalImageReferences':95,
        'englishImageReferences':9,'uniqueDecodedAssets':96,'viewports':[1440,390],
        'scoringDimensions':7,'javascriptErrors':js_errors,'unexpectedFailedRequests':unexpected_failures,
        'checks':['exact fields and dynamic steps','all image references','case navigation/search',
                  'UA/recommendation validation','annotations','per-case/version persistence',
                  'single and collection JSON portability','identity stripping','English UI','mobile overflow'],
    }
    (ARTIFACTS / 'browser_qa.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
    browser.close()
print('PASS: all 50 views fit 1440px and 390px; no Chinese, identity information, JavaScript or resource errors.')
