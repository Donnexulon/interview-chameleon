(function () {
    const STATE_COPY = {
        idle: 'Ready',
        thinking: 'Considering your response',
        speaking: 'Speaking',
        listening: 'Listening',
    };

    function create(options = {}) {
        const root = document.getElementById(options.rootId || 'char-avatar');
        const label = document.getElementById(options.labelId || 'interviewer-state-label');
        let state = 'idle';

        function setState(nextState) {
            const next = Object.prototype.hasOwnProperty.call(STATE_COPY, nextState) ? nextState : 'idle';
            state = next;
            if (root) {
                root.dataset.state = next;
                root.classList.toggle('thinking', next === 'thinking');
                root.classList.toggle('speaking', next === 'speaking');
                root.classList.toggle('listening', next === 'listening');
            }
            if (label) label.textContent = STATE_COPY[next];
        }

        setState(options.initialState || 'idle');
        return { setState, getState: () => state };
    }

    window.InterviewerVisual = { create };
})();
