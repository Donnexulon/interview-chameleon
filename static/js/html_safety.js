(function initializeHtmlSafety(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.InterviewChameleonHtmlSafety = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    return Object.freeze({ escapeHTML });
});
