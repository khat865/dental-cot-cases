"""Bounded browser QA for the local 47-case static site (requires Edge + Playwright)."""
import json
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ENTRY = (ROOT / 'docs/index.html').as_uri()
ARTIFACTS = ROOT / '.runtime/qa'
ARTIFACTS.mkdir(parents=True, exist_ok=True)


with sync_playwright() as p:
    browser = p.chromium.launch(channel='msedge')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    errors, failed_requests = [], []
    context.on('page', lambda page: page.on('pageerror', lambda error: errors.append(str(error))))
    context.on('requestfailed', lambda request: failed_requests.append({'url': request.url, 'failure': request.failure}))
    page = context.new_page()
    page.set_default_timeout(5000)
    page.goto(ENTRY)
    data = page.evaluate('window.COT_DATA')
    cases = data['cases']
    assert len(cases) == len({case['id'] for case in cases}) == 47
    assert sum(len(case['images']) for case in cases) == 95
    english_cases = [case for case in cases if case.get('english')]
    assert len(english_cases) == 3
    assert {case['id'] for case in cases if not case['images']} == {'PMC6738723', 'PMC11297549'}
    expect(page.locator('#caseList [data-case]')).to_have_count(47)
    links = page.locator('#caseList [data-case]').evaluate_all('(els) => els.map(el => el.getAttribute("href"))')
    assert links == ['#case=' + case['id'] for case in cases]
    assert page.locator('#totalCount').inner_text() == '47'
    assert page.locator('#imageCount').inner_text() == '95'

    def route(case, version='original'):
        fragment = '#case=' + case['id'] + ('&version=english' if version == 'english' else '')
        page.evaluate('(fragment) => { location.hash = fragment; }', fragment)
        expect(page.locator('#pmcid')).to_have_text(case['id'])
        expect(page.locator('#languagePill')).to_have_text('English example' if version == 'english' else 'Original · Chinese')
        assert page.locator('#caseTitle').text_content() == case['title']
        current = case['english'] if version == 'english' else case
        rendered = page.evaluate('''() => Object.fromEntries(
            ['question','caption','think','answer'].map(key => [key,document.getElementById(key+'Text').textContent]))''')
        assert rendered == {key: current[key] for key in ('question', 'caption', 'think', 'answer')}, case['id']
        image_refs = page.locator('#gallery img').evaluate_all('(els) => els.map(el => el.getAttribute("src"))')
        assert image_refs == [image['src'] for image in current['images']], (case['id'], version)
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), case['id']
        if not current['images']:
            expect(page.locator('.empty-images')).to_be_visible()
            assert 'text-only' in page.locator('#imageNote').inner_text()
        return fragment

    for case in cases:
        route(case)
    print('PASS: 47 unique routes, exact question/Caption/Think/Answer, matching image references, two text-only cases', flush=True)

    # Independently decode every reference, including the nine English references.
    decoded = page.evaluate('''async () => {
        const references = window.COT_DATA.cases.flatMap(c => [
            ...c.images.map(im => ({...im, caseId:c.id, version:'original'})),
            ...(c.english?.images || []).map(im => ({...im, caseId:c.id, version:'english'}))
        ]);
        return Promise.all(references.map(im => new Promise(resolve => {
            const image = new Image();
            image.onload = () => resolve({src:im.src, caseId:im.caseId, version:im.version,
                ok:image.naturalWidth===im.width && image.naturalHeight===im.height,
                width:image.naturalWidth,height:image.naturalHeight});
            image.onerror = () => resolve({src:im.src,caseId:im.caseId,version:im.version,ok:false});
            image.src=im.src;
        })));
    }''')
    assert len(decoded) == 104
    assert all(image['ok'] for image in decoded), [image for image in decoded if not image['ok']]
    assert len({image['src'] for image in decoded}) == 96

    for case in english_cases:
        route(case)
        expect(page.locator('#versionSelect')).to_be_enabled()
        page.locator('#versionSelect').select_option('english')
        expect(page.locator('#languagePill')).to_have_text('English example')
        route(case, 'english')
        assert page.url.endswith('#case=' + case['id'] + '&version=english')
        page.reload()
        expect(page.locator('#languagePill')).to_have_text('English example')
        assert page.locator('#questionText').text_content() == case['english']['question']
    assert len([image for image in decoded if image['version'] == 'original']) == 95
    print('PASS: all 104 image references decode (96 assets), three English variants and reloadable deep links', flush=True)

    # Search, empty state, reset, and every filter preserve directory navigation.
    page.locator('#searchInput').fill(cases[10]['id'])
    expect(page.locator('#caseList [data-case]')).to_have_count(1)
    expect(page.locator('#pmcid')).to_have_text(cases[10]['id'])
    page.locator('#searchInput').fill('QA-no-such-case-9a08267d')
    expect(page.locator('#noResults')).to_be_visible()
    expect(page.locator('#caseMain')).not_to_be_visible()
    expect(page.locator('#resultCount')).to_have_text('0')
    page.locator('#clearSearch').click()
    expect(page.locator('#caseList [data-case]')).to_have_count(47)
    filter_counts = {}
    for filter_value in ('radiograph', 'rgb', 'ct', 'text', 'english'):
        page.locator('#filterSelect').select_option(filter_value)
        ids = page.locator('#caseList [data-case]').evaluate_all('(els) => els.map(el => el.dataset.case)')
        assert ids and len(ids) == int(page.locator('#resultCount').inner_text())
        assert page.locator('#pmcid').inner_text() in ids
        filter_counts[filter_value] = len(ids)
        if filter_value == 'text':
            assert set(ids) == {'PMC6738723', 'PMC11297549'}
        if filter_value == 'english':
            assert set(ids) == {case['id'] for case in english_cases}
    page.locator('#filterSelect').select_option('all')
    route(cases[0])
    expect(page.locator('#prevCase')).to_be_disabled()
    page.locator('#nextCase').click()
    expect(page.locator('#pmcid')).to_have_text(cases[1]['id'])
    page.locator('#prevCase').click()
    expect(page.locator('#pmcid')).to_have_text(cases[0]['id'])
    route(cases[-1])
    expect(page.locator('#nextCase')).to_be_disabled()

    # Follow a real directory link; verify browser history and a fresh-page deep link.
    page.locator('[data-case="' + cases[3]['id'] + '"]').click()
    expect(page.locator('#pmcid')).to_have_text(cases[3]['id'])
    page.locator('#nextCase').click()
    expect(page.locator('#pmcid')).to_have_text(cases[4]['id'])
    page.go_back()
    expect(page.locator('#pmcid')).to_have_text(cases[3]['id'])
    deep_page = context.new_page()
    deep_page.goto(ENTRY + '#case=' + cases[-1]['id'])
    expect(deep_page.locator('#pmcid')).to_have_text(cases[-1]['id'])
    assert deep_page.locator('#thinkText').text_content() == cases[-1]['think']
    deep_page.close()

    zoom_case = next(case for case in cases if len(case['images']) >= 2)
    route(zoom_case)
    page.locator('[data-image="0"]').click()
    expect(page.locator('#zoom')).to_be_visible()
    expect(page.locator('#prevImage')).to_be_disabled()
    assert page.locator('#zoomImage').get_attribute('src') == zoom_case['images'][0]['src']
    page.locator('#nextImage').click()
    assert page.locator('#zoomImage').get_attribute('src') == zoom_case['images'][1]['src']
    page.keyboard.press('ArrowLeft')
    assert page.locator('#zoomImage').get_attribute('src') == zoom_case['images'][0]['src']
    page.keyboard.press('ArrowRight')
    assert page.locator('#zoomImage').get_attribute('src') == zoom_case['images'][1]['src']
    page.keyboard.press('Escape')
    expect(page.locator('#zoom')).not_to_be_visible()
    page.locator('#aboutButton').click()
    expect(page.locator('#about')).to_be_visible()
    page.locator('[data-close="about"]').click()
    page.locator('#caseMain').focus()
    page.keyboard.press('/')
    expect(page.locator('#searchInput')).to_be_focused()
    print('PASS: search/reset, all filters, next/previous/history, fresh deep links, image zoom/keyboard navigation', flush=True)

    page.set_viewport_size({'width': 390, 'height': 844})
    for case in cases:
        route(case)
    for case in english_cases:
        route(case, 'english')
    page.locator('#aboutButton').click()
    assert page.locator('#about').evaluate('(el) => el.scrollWidth <= el.clientWidth')
    page.locator('[data-close="about"]').click()
    assert not errors, errors
    # Rapid routing may cancel prior gallery loads. All references are separately decoded above.
    unexpected_failures = [request for request in failed_requests if 'ERR_ABORTED' not in request['failure']]
    assert not unexpected_failures, unexpected_failures
    result = {
        'status': 'passed', 'browser': 'Microsoft Edge', 'entry': 'docs/index.html',
        'cases': 47, 'originalImageReferences': 95, 'englishVariants': 3,
        'englishImageReferences': 9, 'uniqueDecodedAssets': 96, 'textOnlyCases': 2,
        'exactTextViewsChecked': 100, 'viewports': [1440, 390], 'filterCounts': filter_counts,
        'javascriptErrors': errors, 'unexpectedFailedRequests': unexpected_failures,
        'checks': ['routes', 'source text', 'version-image pairing', 'image decode and dimensions',
                   'search and reset', 'filters', 'case navigation', 'browser history', 'deep links',
                   'zoom and keyboard navigation', 'mobile overflow'],
    }
    (ARTIFACTS / 'browser_qa.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
    browser.close()

print('PASS: all 50 original/English views fit desktop 1440px and mobile 390px; no JavaScript or resource errors.')
