/*
 * Shared HTML-safety helpers for the admin dashboard.
 *
 * Every value that comes from the API (names, emails, notes, messages, URLs)
 * is untrusted. Interpolate it into template strings only through esc(), and
 * use safeUrl() for href/src. Trusted markup built inside this file or by the
 * renderers themselves is not escaped.
 */
(function () {
    const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

    // Escape for HTML text and for quoted attribute values.
    function esc(value) {
        if (value === null || value === undefined) return '';
        return String(value).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
    }

    // Allow only http(s) URLs and same-origin relative paths. Anything else
    // (javascript:, data:, protocol-relative tricks) becomes an empty string.
    function safeUrl(value) {
        if (value === null || value === undefined) return '';
        const raw = String(value).trim();
        if (!raw) return '';
        if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
        try {
            const parsed = new URL(raw, window.location.origin);
            if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
        } catch (_) { /* fall through */ }
        return '';
    }

    window.esc = esc;
    window.safeUrl = safeUrl;
})();
