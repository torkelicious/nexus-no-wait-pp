import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../NexusNoWaitPP.user.js', import.meta.url), 'utf8')

function subject(responses = []) {
    // Expose the real functions without installing listeners or starting downloads.
    const instrumented = source.replace('    // initialization', '    globalThis.subject = { isCloudflareChallenge, getDownloadUrl }; return;\n    // initialization')
    const requests = []
    const context = vm.createContext({
        URL,
        URLSearchParams,
        location: new URL('https://www.nexusmods.com/skyrimspecialedition/mods/42'),
        GM_info: { script: { version: 'test' } },
        console: { debug() {}, info() {}, warn() {}, error() {} },
        GM_xmlhttpRequest(options) {
            requests.push(options.url)
            const next = responses.shift()
            assert.ok(next, `Unexpected request: ${options.url}`)
            options.onload({ responseText: next.text, responseHeaders: next.headers, status: next.status, finalUrl: options.url })
        }
    })
    vm.runInContext(instrumented, context, { filename: 'NexusNoWaitPP.user.js' })
    return { ...context.subject, requests }
}

const response = (text, headers = '', status = 200) => ({ text, headers, status })

test('a cf-mitigated challenge header is authoritative even without a response body', () => {
    const { isCloudflareChallenge } = subject()
    assert.equal(isCloudflareChallenge(response('', 'Content-Type: text/html\r\nCF-Mitigated: challenge\r\n', 403)), true)
    assert.equal(isCloudflareChallenge(response('', 'cf-mitigated: CHALLENGE\n', 200)), true)
    assert.equal(isCloudflareChallenge(response('', 'x-cf-mitigated: challenge\n', 403)), false)
})

test('ordinary forbidden and outage pages behind Cloudflare are not challenges', () => {
    const { isCloudflareChallenge } = subject()
    for (const status of [403, 503]) {
        assert.equal(isCloudflareChallenge(response('<html><h1>Service unavailable</h1></html>', 'server: cloudflare\r\ncf-ray: example\r\n', status)), false)
    }
})

test('valid JSON is not scanned as challenge-page prose', () => {
    const { isCloudflareChallenge } = subject()
    const body = JSON.stringify({ downloadUrl: 'https://files.nexus-cdn.com/Just a moment.zip', description: 'Attention Required! cf-turnstile window._cf_chl_opt' })
    assert.equal(isCloudflareChallenge(response(body, 'content-type: application/json')), false)
    assert.equal(isCloudflareChallenge(response(body)), false)
    assert.equal(isCloudflareChallenge(response(body, 'cf-mitigated: challenge')), true)
})

test('passive bot detection and embedded Turnstile widgets do not block normal pages', () => {
    const { isCloudflareChallenge } = subject()
    assert.equal(isCloudflareChallenge(response('<html><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></html>')), false)
    assert.equal(isCloudflareChallenge(response('<html><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script><div class="cf-turnstile"></div></html>')), false)
    assert.equal(isCloudflareChallenge(response('<html><h1>Just a moment mod</h1><p>Attention Required! Read the installation notes.</p></html>')), false)
})

test('interstitial markup and challenge titles remain recognized without the header', () => {
    const { isCloudflareChallenge } = subject()
    for (const body of [
        '<html><form id="challenge-form"></form></html>',
        "<html><form id='challenge-form'></form></html>",
        '<html><script>window._cf_chl_opt = {}</script></html>',
        '<html><script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script></html>',
        '<html><div class="cf-browser-verification"></div></html>',
        '<html><title>Just a moment...</title></html>',
        '<html><title>Attention Required! | Cloudflare</title></html>'
    ]) assert.equal(isCloudflareChallenge(response(body)), true, body)
    assert.equal(isCloudflareChallenge(response('<html><title>Just a moment...</title></html>', 'content-type: application/json')), true)
})

test('missing and empty responses are not challenges', () => {
    const { isCloudflareChallenge } = subject()
    for (const value of [null, undefined, {}, response('')]) assert.equal(isCloudflareChallenge(value), false)
})

test('a download URL containing challenge-like words still resolves', async () => {
    const url = 'https://files.nexus-cdn.com/Just a moment.zip'
    const { getDownloadUrl } = subject([response(JSON.stringify({ downloadUrl: url }), 'content-type: application/json')])
    assert.equal((await getDownloadUrl({ fileId: '123', gameId: '1704', isNMM: false })).url, url)
})

test('a non-challenge 503 still permits the existing file-page fallback', async () => {
    const url = 'https://files.nexus-cdn.com/mod.zip'
    const { getDownloadUrl, requests } = subject([
        response('<html><h1>Service unavailable</h1></html>', 'server: cloudflare\ncf-ray: example\n', 503),
        response(JSON.stringify({ downloadUrl: url }), 'content-type: application/json')
    ])
    const result = await getDownloadUrl({ fileId: '123', gameId: '1704', isNMM: false })
    assert.equal(result.url, url)
    assert.equal(requests.length, 2)
    assert.equal(requests[1], 'https://www.nexusmods.com/skyrimspecialedition/mods/42?tab=files&file_id=123')
})

test('a challenged GenerateDownloadUrl response stops before further requests', async () => {
    const { getDownloadUrl, requests } = subject([response('', 'cf-mitigated: challenge', 403)])
    const result = await getDownloadUrl({ fileId: '123', gameId: '1704', isNMM: false })
    assert.equal(result.error, 'cloudflare-challenge')
    assert.equal(result.blockedUrl, 'https://www.nexusmods.com/skyrimspecialedition/mods/42?tab=files&file_id=123')
    assert.equal(requests.length, 1)
})
