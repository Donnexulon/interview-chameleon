(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.InterviewCarousel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    function assertLength(length) {
        if (!Number.isInteger(length) || length <= 0) {
            throw new RangeError('Carousel length must be a positive integer.');
        }
    }

    function wrapIndex(index, length) {
        assertLength(length);
        return ((index % length) + length) % length;
    }

    // Three copies of the card rail are rendered. After each transition, move
    // invisibly to the matching card in the middle copy so either arrow can be
    // used forever without reaching an edge.
    function normalizeTrackIndex(index, length) {
        assertLength(length);
        return length + wrapIndex(index - length, length);
    }

    function nextState(trackIndex, logicalOffset, direction, length) {
        assertLength(length);
        const step = direction > 0 ? 1 : direction < 0 ? -1 : 0;
        return {
            step,
            destinationIndex: trackIndex + step,
            logicalOffset: wrapIndex(logicalOffset + step, length),
        };
    }

    function shouldRemainColored(isHovered, isSelected) {
        return Boolean(isHovered || isSelected);
    }

    return { wrapIndex, normalizeTrackIndex, nextState, shouldRemainColored };
});
