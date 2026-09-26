/** Local-only speech adapter. Never selects voices backed by a network service. */
(function () {
    let active = null;

    function voices() {
        if (!('speechSynthesis' in window)) return [];
        return window.speechSynthesis.getVoices().filter(voice => voice.localService === true);
    }

    function selectVoice(gender, preferredName) {
        const local = voices();
        if (preferredName) {
            const preferred = local.find(voice => voice.name === preferredName);
            if (preferred) return preferred;
        }
        const english = local.filter(voice => /^en([-_]|$)/i.test(voice.lang || ''));
        const pool = english.length ? english : local;
        const hints = gender === 'male'
            ? /male|david|mark|guy|george|james/i
            : /female|zira|susan|hazel|samantha|aria/i;
        return pool.find(voice => hints.test(voice.name)) || pool[0] || null;
    }

    function stop() {
        if (!active) return;
        const previous = active;
        active = null;
        window.speechSynthesis.cancel();
        previous.finish();
    }

    function speak(text, options = {}) {
        stop();
        const voice = selectVoice(options.gender || 'female', options.preferredVoice || '');
        if (!voice || !String(text || '').trim()) return null;
        const utterance = new SpeechSynthesisUtterance(String(text));
        utterance.voice = voice;
        utterance.lang = voice.lang || 'en-US';
        utterance.rate = 0.96;
        let finished = false;
        const controller = {
            voice,
            pause: stop,
            finish() {
                if (finished) return;
                finished = true;
                if (active === controller) active = null;
                options.onEnd?.();
            },
        };
        utterance.onstart = () => options.onStart?.();
        utterance.onend = controller.finish;
        utterance.onerror = controller.finish;
        active = controller;
        window.speechSynthesis.speak(utterance);
        return controller;
    }

    window.LocalSpeech = { voices, speak, stop, available: () => voices().length > 0 };
})();
