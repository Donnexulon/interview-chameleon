(function () {
    'use strict';

    const simpleMappings = {
        theme: ['theme', false],
        question_favorites: ['qb_favorites', true],
        minigame_runs: ['mg_runs_v2', true],
        industries_used: ['ai_coach_industries_used', true],
        faang_sessions: ['ai_coach_faang_sessions', true],
        no_timeout_sessions: ['ai_coach_no_timeout_sessions', true],
        earned_badges: ['ai_coach_badges', true],
    };
    const bestKeyToGame = {
        mg_blitz_best: 'blitz',
        mg_star_best: 'star',
        mg_salary_best: 'salary',
    };
    const localKeyToPreference = Object.fromEntries(
        Object.entries(simpleMappings).map(([preference, [localKey]]) => [localKey, preference])
    );
    let preferences = {};
    let saveChain = Promise.resolve();

    function parseJSON(value, fallback) {
        try {
            const parsed = JSON.parse(value);
            return parsed === null ? fallback : parsed;
        } catch (_) {
            return fallback;
        }
    }

    function cachePreference(preference, value) {
        const mapping = simpleMappings[preference];
        if (!mapping) return;
        const [localKey, isJSON] = mapping;
        localStorage.setItem(localKey, isJSON ? JSON.stringify(value) : String(value));
    }

    function hydrate(nextPreferences) {
        preferences = nextPreferences && typeof nextPreferences === 'object' ? nextPreferences : {};
        Object.entries(simpleMappings).forEach(([preference]) => {
            if (Object.prototype.hasOwnProperty.call(preferences, preference)) {
                cachePreference(preference, preferences[preference]);
            }
        });
        const bests = preferences.minigame_bests && typeof preferences.minigame_bests === 'object'
            ? preferences.minigame_bests
            : {};
        Object.entries(bestKeyToGame).forEach(([localKey, game]) => {
            if (bests[game]) localStorage.setItem(localKey, JSON.stringify(bests[game]));
            else localStorage.removeItem(localKey);
        });
        const theme = preferences.theme || localStorage.getItem('theme') || 'dark';
        document.documentElement.classList.toggle('dark', theme === 'dark');
    }

    const ready = fetch('/api/preferences')
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('preferences unavailable')))
        .then((data) => hydrate(data.preferences || data))
        .catch(() => {
            document.documentElement.classList.toggle('dark', (localStorage.getItem('theme') || 'dark') === 'dark');
        });

    function setItem(localKey, value) {
        localStorage.setItem(localKey, value);
        let update = null;
        const preference = localKeyToPreference[localKey];
        if (preference) {
            const isJSON = simpleMappings[preference][1];
            update = { [preference]: isJSON ? parseJSON(value, preferences[preference]) : String(value) };
        } else if (bestKeyToGame[localKey]) {
            const game = bestKeyToGame[localKey];
            update = {
                minigame_bests: {
                    ...(preferences.minigame_bests || {}),
                    [game]: parseJSON(value, {}),
                },
            };
        }
        if (!update) return Promise.resolve(false);
        Object.assign(preferences, update);
        saveChain = saveChain
            .catch(() => null)
            .then(() => fetch('/api/preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(update),
            }))
            .then((response) => response.ok ? response.json() : Promise.reject(new Error('preference save failed')))
            .then((data) => {
                preferences = data.preferences || preferences;
                return true;
            })
            .catch((error) => {
                console.error('Local progress could not be saved:', error);
                return false;
            });
        return saveChain;
    }

    function flush() {
        return ready.then(() => saveChain).then(() => true).catch(() => false);
    }

    window.InterviewChameleonStorage = { ready, setItem, flush };
})();
