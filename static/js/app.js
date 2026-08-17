document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.getElementById('main-content');

    function escapeHTML(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function iconName(value) {
        return String(value || 'circle').replace(/[^a-z0-9-]/gi, '') || 'circle';
    }

    function ti(name, className = '', label = '') {
        const safeName = iconName(name);
        const safeClass = className ? ` ${escapeHTML(className)}` : '';
        const aria = label
            ? ` role="img" aria-label="${escapeHTML(label)}"`
            : ' aria-hidden="true"';
        return `<i class="ti ti-${safeName}${safeClass}"${aria}></i>`;
    }

    function iconBox(name, className = '', label = '') {
        return `<span class="ui-icon-box${className ? ` ${escapeHTML(className)}` : ''}">${ti(name, 'ui-icon', label)}</span>`;
    }

    /* -- Stars Background Utility -- */
    const STAR_COUNTS = [700, 300, 150];
    const FIELD_RANGE = 4000;
    const STAR_COLORS_TBL = [
        { threshold: 0.95, color: '#ffffff' },
        { threshold: 0.985, color: '#f5a623' },
        { threshold: 0.9975, color: '#38d2d2' },
        { threshold: 1.0, color: '#b07eff' },
    ];
    function pickStarColor() {
        const r = Math.random();
        for (const e of STAR_COLORS_TBL) { if (r <= e.threshold) return e.color; }
        return '#ffffff';
    }
    function generateStars(count) {
        const s = [];
        for (let i = 0; i < count; i++) {
            const x = Math.floor(Math.random() * FIELD_RANGE) - FIELD_RANGE / 2;
            const y = Math.floor(Math.random() * FIELD_RANGE) - FIELD_RANGE / 2;
            s.push(`${x}px ${y}px ${pickStarColor()}`);
        }
        return s.join(', ');
    }
    function starsHTML(id) {
        return `<div class="stars-bg" id="${id}">
            <div class="stars-parallax" id="${id}-px">
                <div class="star-layer star-layer--1" id="${id}-l1"></div>
                <div class="star-layer star-layer--1" id="${id}-l1b" style="top:2000px"></div>
                <div class="star-layer star-layer--2" id="${id}-l2"></div>
                <div class="star-layer star-layer--2" id="${id}-l2b" style="top:2000px"></div>
                <div class="star-layer star-layer--3" id="${id}-l3"></div>
                <div class="star-layer star-layer--3" id="${id}-l3b" style="top:2000px"></div>
            </div>
        </div>`;
    }
    function initStarsBg(id) {
        [
            [`${id}-l1`, `${id}-l1b`, STAR_COUNTS[0]],
            [`${id}-l2`, `${id}-l2b`, STAR_COUNTS[1]],
            [`${id}-l3`, `${id}-l3b`, STAR_COUNTS[2]],
        ].forEach(([a, b, count]) => {
            const shadow = generateStars(count);
            const elA = document.getElementById(a);
            const elB = document.getElementById(b);
            if (elA) elA.style.boxShadow = shadow;
            if (elB) elB.style.boxShadow = shadow;
        });
        const pw = document.getElementById(`${id}-px`);
        if (pw) {
            document.addEventListener('mousemove', (e) => {
                const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
                pw.style.transform = `translate(${-(e.clientX - cx) * 0.04}px, ${-(e.clientY - cy) * 0.04}px)`;
            });
        }
    }

    // Theme Management
    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const isDark = document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });
    }
    let state = {
        selectedModel: 'qwen2.5:7b',
        resumeText: '',
        targetRole: '',
        jobDescription: '',
        interviewerPersona: { character: 'friendly', gender: 'female' },
        selectedModule: null,
        difficulty: 'medium',
        duration: 'standard',
        chatHistory: [],
        currentSessionId: null,
        cameraStream: null,
        cameraEnabled: true,
        blindMirror: true,
        industry: 'general',      // NEW: Industry Customization
        faangMode: false,          // NEW: FAANG Filter Mode
        interruptionsEnabled: false // NEW: Interruption Simulation
    };

    const MG_RUNS_KEY = 'mg_runs_v2';
    const MG_BEST_KEYS = {
        blitz: 'mg_blitz_best',
        star: 'mg_star_best',
        salary: 'mg_salary_best',
    };
    const MG_META = {
        blitz: { label: '60-Second Blitz', icon: 'bolt', color: '#fbbf24' },
        star: { label: 'STAR Builder', icon: 'stars', color: '#a78bfa' },
        salary: { label: 'Salary Dare', icon: 'cash-banknote', color: '#4ade80' },
    };

    function clampScore(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return 0;
        return Math.max(0, Math.min(100, Math.round(n)));
    }

    function readStoredJSON(key, fallback) {
        try {
            const value = JSON.parse(localStorage.getItem(key) || 'null');
            return value === null ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }

    function countWords(text) {
        return String(text || '').trim().split(/\s+/).filter(Boolean).length;
    }

    function tokenize(text) {
        return String(text || '').toLowerCase().match(/[a-z0-9]+(?:'[a-z0-9]+)?/g) || [];
    }

    function averageScore(values) {
        const nums = values.filter(v => Number.isFinite(v));
        return nums.length ? clampScore(nums.reduce((s, v) => s + v, 0) / nums.length) : 0;
    }

    function scoreTextSignals(text) {
        const raw = String(text || '');
        const words = tokenize(raw);
        const uniqueWords = new Set(words);
        const wordCount = words.length;
        const firstPersonMatches = raw.match(/\b(I|I've|I'd|I'll|my|mine|me)\b/gi) || [];
        const metricMatches = raw.match(/(\d+%?|\$[\d,.]+|\b\d+\s*(users|customers|clients|weeks|months|days|hours|people|tickets|deals|revenue|costs?)\b)/gi) || [];
        const actionMatches = raw.match(/\b(created|built|led|designed|negotiated|reduced|increased|fixed|managed|launched|implemented|analyzed|resolved|presented|delivered|prioritized|coordinated|measured|improved|owned|shipped|partnered|validated)\b/gi) || [];
        const vagueMatches = raw.match(/\b(stuff|things|etc|basically|kind of|sort of|maybe|probably|good|bad|nice|great|helped out|worked on)\b/gi) || [];
        const fillerMatches = raw.match(/\b(um|uh|like|you know|honestly|actually)\b/gi) || [];
        const sentenceCount = (raw.match(/[.!?]+/g) || []).length || (wordCount ? 1 : 0);
        const avgSentenceLength = sentenceCount ? wordCount / sentenceCount : 0;
        const hasConstraint = /\b(deadline|budget|stakeholder|risk|trade[- ]?off|blocked|ambiguous|pressure|constraint|limited|competing|priority|scope)\b/i.test(raw);
        const hasOutcome = /\b(result|outcome|impact|improved|reduced|increased|saved|grew|launched|shipped|unlocked|resolved|delivered|converted|retained)\b/i.test(raw);
        return {
            word_count: wordCount,
            unique_word_count: uniqueWords.size,
            first_person_count: firstPersonMatches.length,
            metric_count: metricMatches.length,
            action_verb_count: actionMatches.length,
            vague_count: vagueMatches.length,
            filler_count: fillerMatches.length,
            sentence_count: sentenceCount,
            avg_sentence_length: Math.round(avgSentenceLength),
            has_metric: metricMatches.length > 0,
            has_first_person: firstPersonMatches.length > 0,
            has_action_verb: actionMatches.length > 0,
            has_constraint: hasConstraint,
            has_outcome: hasOutcome,
            specificity_score: clampScore((Math.min(wordCount, 90) / 90 * 28) + (Math.min(metricMatches.length, 2) * 18) + (Math.min(actionMatches.length, 4) * 8) + (hasConstraint ? 14 : 0) + (hasOutcome ? 14 : 0) - Math.min(vagueMatches.length * 8, 24)),
            clarity_score: clampScore(80 + (wordCount >= 25 && wordCount <= 160 ? 12 : 0) - Math.max(0, avgSentenceLength - 28) * 1.5 - Math.min(fillerMatches.length * 5, 20) - Math.min(vagueMatches.length * 4, 18)),
        };
    }

    function getMinigameRuns(game = null) {
        const runs = readStoredJSON(MG_RUNS_KEY, []);
        const list = Array.isArray(runs) ? runs : [];
        return game ? list.filter(run => run.game === game) : list;
    }

    function saveMinigameRun(run) {
        const normalized = {
            id: run.id || (crypto.randomUUID ? crypto.randomUUID() : `mg_${Date.now()}_${Math.random().toString(16).slice(2)}`),
            game: run.game,
            created_at: run.created_at || new Date().toISOString(),
            score: clampScore(run.score),
            competency_scores: run.competency_scores || {},
            summary: run.summary || '',
            strengths: Array.isArray(run.strengths) ? run.strengths.slice(0, 4) : [],
            improvements: Array.isArray(run.improvements) ? run.improvements.slice(0, 4) : [],
            raw: run.raw || {},
        };
        const runs = getMinigameRuns();
        runs.unshift(normalized);
        localStorage.setItem(MG_RUNS_KEY, JSON.stringify(runs.slice(0, 60)));
        return normalized;
    }

    function updateMinigameBest(game, result) {
        const key = MG_BEST_KEYS[game];
        if (!key) return;
        const prev = readStoredJSON(key, null);
        if (game === 'salary') {
            const gain = Number(result.gain || 0);
            if (!prev || gain > Number(prev.gain || 0)) {
                localStorage.setItem(key, JSON.stringify({ gain, score: clampScore(result.score), date: new Date().toISOString() }));
            }
            return;
        }
        const score = clampScore(result.score);
        if (!prev || score > Number(prev.score || 0)) {
            localStorage.setItem(key, JSON.stringify({ score, date: new Date().toISOString() }));
        }
    }

    function latestFeedbackForMinigames() {
        const candidates = [];
        if (state.lastSessionFeedback) candidates.push({ date: Date.now(), feedback: state.lastSessionFeedback });
        if (Array.isArray(state.sessionHistoryCache)) {
            state.sessionHistoryCache.forEach(session => {
                if (session?.feedback) candidates.push({ date: Date.parse(session.date || '') || 0, feedback: session.feedback });
            });
        }
        candidates.sort((a, b) => b.date - a.date);
        return candidates[0]?.feedback || null;
    }

    function getRecommendedDrillFromLatestFeedback() {
        const feedback = latestFeedbackForMinigames();
        const scores = feedback?.pillars?.interview?.competency_scores || feedback?.competency_scores || {};
        const entries = Object.entries(scores).filter(([, value]) => typeof value === 'number');
        if (!entries.length) {
            return {
                game: 'star',
                competency: 'structure',
                score: null,
                reason: 'Start with STAR Builder to create reusable, structured behavioral answers.',
            };
        }
        entries.sort((a, b) => a[1] - b[1]);
        const [weakest, score] = entries[0];
        const starSet = new Set(['structure', 'specificity', 'evidence_quality']);
        const blitzSet = new Set(['communication_clarity', 'answer_relevance']);
        const salarySet = new Set(['adaptability', 'impact_orientation']);
        const game = starSet.has(weakest) ? 'star' : blitzSet.has(weakest) ? 'blitz' : salarySet.has(weakest) ? 'salary' : 'star';
        const reason = {
            star: 'Your last report points to answer structure, evidence, or specificity.',
            blitz: 'Your last report points to directness and clear, concise answers.',
            salary: 'Your last report points to adaptability, pressure handling, or impact framing.',
        }[game];
        return { game, competency: weakest, score, reason };
    }

    async function refreshMinigameRecommendation() {
        if (!state.sessionHistoryCache) {
            try {
                const res = await fetch('/api/sessions');
                const data = await res.json();
                state.sessionHistoryCache = data.sessions || [];
            } catch (e) {
                return;
            }
        }
        const card = document.getElementById('mg-recommendation-card');
        if (!card) return;
        const rec = getRecommendedDrillFromLatestFeedback();
        const meta = MG_META[rec.game] || MG_META.star;
        card.innerHTML = `
            <div class="mg-rec-top">
                <div class="mg-rec-ico" style="color:${meta.color};background:${meta.color}16;border-color:${meta.color}45">${ti(meta.icon)}</div>
                <div>
                    <div class="mg-rec-kicker">Recommended drill</div>
                    <div class="mg-rec-title">${escapeHTML(meta.label)}</div>
                </div>
                <button class="mg-rec-btn" onclick="window.nav_game('${rec.game}')">${ti('player-play')} Start</button>
            </div>
            <div class="mg-rec-copy">${escapeHTML(rec.reason)}${rec.score !== null ? ` Weakest signal: ${escapeHTML(rec.competency.replace(/_/g, ' '))} (${rec.score}/100).` : ''}</div>
        `;
    }

    function createDemoSession() {
        const base = Date.now() - 13 * 60 * 1000;
        const stamp = (minutes) => new Date(base + minutes * 60 * 1000).toISOString();
        const messages = [
            { role: 'assistant', content: 'Tell me about a product launch you led.', timestamp: stamp(0) },
            { role: 'user', content: 'I led the onboarding analytics launch for a 12-person SaaS team. We found activation dropped after invite setup, so I worked with design and engineering to ship guided setup, new event tracking, and lifecycle emails. Activation improved from 42% to 61% in six weeks.', timestamp: stamp(1) },
            { role: 'assistant', content: 'How do you decide what to prioritize when there are competing requests?', timestamp: stamp(3) },
            { role: 'user', content: 'I start with user pain, revenue impact, and effort. For the analytics launch, I scored opportunities with support-ticket volume, funnel loss, and engineering complexity. That helped us choose setup guidance over a larger dashboard redesign.', timestamp: stamp(4) },
            { role: 'assistant', content: 'Describe a conflict with a stakeholder and how you handled it.', timestamp: stamp(6) },
            { role: 'user', content: 'Sales wanted a custom enterprise report, but engineering was worried it would derail the roadmap. I brought both teams into a trade-off review, separated must-have compliance fields from nice-to-have visuals, and shipped a smaller report template that unlocked the deal without a one-off build.', timestamp: stamp(7) },
            { role: 'assistant', content: 'What is an area you still need to improve?', timestamp: stamp(9) },
            { role: 'user', content: 'I can tighten executive communication. I sometimes share too much discovery detail before the recommendation, so I am practicing starting with the decision, then backing it with two or three data points.', timestamp: stamp(10) },
            { role: 'assistant', content: 'What would you do in your first 30 days in this role?', timestamp: stamp(11) },
            { role: 'user', content: 'In the first 30 days I would map the activation funnel, interview five customers and five support agents, review roadmap commitments, and define one measurable onboarding bet with engineering.', timestamp: stamp(12) }
        ];

        const competencyScores = {
            answer_relevance: 90,
            specificity: 86,
            structure: 84,
            evidence_quality: 88,
            impact_orientation: 91,
            role_alignment: 89,
            communication_clarity: 82,
            adaptability: 84
        };
        const interviewScores = {
            responsiveness: 90,
            depth: 88,
            clarity: 83,
            communication_style: 87
        };
        const questionEvaluations = [
            {
                question: 'Tell me about a product launch you led.',
                answer_summary: 'Strong launch example with team context, concrete product work, and a measurable activation lift.',
                answer_type: 'complete',
                score: 91,
                competency_scores: {
                    answer_relevance: 94,
                    specificity: 90,
                    structure: 86,
                    evidence_quality: 92,
                    impact_orientation: 95,
                    role_alignment: 90,
                    communication_clarity: 86,
                    adaptability: 84
                },
                evidence_quotes: [
                    'I worked with design and engineering to ship guided setup',
                    'Activation improved from 42% to 61% in six weeks.'
                ],
                missed_opportunity: 'Add one sentence on tradeoffs or what was deliberately deprioritized.',
                coaching_note: 'This is the strongest answer because it shows ownership, cross-functional work, and a clear outcome.',
                practice_drill: 'Repeat this answer in a 90-second STAR format with the metric at the end.'
            },
            {
                question: 'How do you decide what to prioritize when there are competing requests?',
                answer_summary: 'Clear prioritization method using user pain, revenue impact, effort, and real launch criteria.',
                answer_type: 'complete',
                score: 88,
                competency_scores: {
                    answer_relevance: 91,
                    specificity: 88,
                    structure: 84,
                    evidence_quality: 86,
                    impact_orientation: 90,
                    role_alignment: 90,
                    communication_clarity: 84,
                    adaptability: 82
                },
                evidence_quotes: [
                    'I start with user pain, revenue impact, and effort.',
                    'I scored opportunities with support-ticket volume, funnel loss, and engineering complexity.'
                ],
                missed_opportunity: 'Name the final decision owner or how disagreements were resolved.',
                coaching_note: 'The framework is practical and role-relevant; make the decision process sound more decisive.',
                practice_drill: 'Give a 60-second prioritization answer with three criteria and one explicit tradeoff.'
            },
            {
                question: 'Describe a conflict with a stakeholder and how you handled it.',
                answer_summary: 'Good stakeholder conflict answer with negotiation, scope control, and business outcome.',
                answer_type: 'complete',
                score: 86,
                competency_scores: {
                    answer_relevance: 90,
                    specificity: 84,
                    structure: 84,
                    evidence_quality: 86,
                    impact_orientation: 88,
                    role_alignment: 89,
                    communication_clarity: 83,
                    adaptability: 88
                },
                evidence_quotes: [
                    'Sales wanted a custom enterprise report, but engineering was worried it would derail the roadmap.',
                    'shipped a smaller report template that unlocked the deal without a one-off build.'
                ],
                missed_opportunity: 'Quantify the deal size or explain how the template became reusable.',
                coaching_note: 'This shows strong product judgment and cross-functional mediation.',
                practice_drill: 'Practice ending this answer with the durable product principle you used.'
            },
            {
                question: 'What is an area you still need to improve?',
                answer_summary: 'Self-aware improvement answer that identifies a specific communication habit and practice plan.',
                answer_type: 'complete',
                score: 82,
                competency_scores: {
                    answer_relevance: 88,
                    specificity: 80,
                    structure: 80,
                    evidence_quality: 78,
                    impact_orientation: 78,
                    role_alignment: 84,
                    communication_clarity: 82,
                    adaptability: 86
                },
                evidence_quotes: [
                    'I can tighten executive communication.',
                    'I am practicing starting with the decision, then backing it with two or three data points.'
                ],
                missed_opportunity: 'Add a recent example where this practice improved a meeting or decision.',
                coaching_note: 'The answer is honest without creating a major risk, but it should include proof of progress.',
                practice_drill: 'Rewrite one answer as recommendation first, then support it with exactly three bullets.'
            },
            {
                question: 'What would you do in your first 30 days in this role?',
                answer_summary: 'Practical 30-day plan with discovery, stakeholder learning, roadmap review, and one measurable bet.',
                answer_type: 'complete',
                score: 87,
                competency_scores: {
                    answer_relevance: 90,
                    specificity: 86,
                    structure: 86,
                    evidence_quality: 84,
                    impact_orientation: 88,
                    role_alignment: 90,
                    communication_clarity: 84,
                    adaptability: 86
                },
                evidence_quotes: [
                    'map the activation funnel, interview five customers and five support agents',
                    'define one measurable onboarding bet with engineering.'
                ],
                missed_opportunity: 'Mention how you would align the first bet with company strategy or revenue goals.',
                coaching_note: 'This is a credible ramp plan; make it sharper by naming the expected output of the first 30 days.',
                practice_drill: 'Turn this into a 30-60-90 answer with one measurable artifact per phase.'
            }
        ];
        const questionHighlights = questionEvaluations.map((item) => ({
            question: item.question,
            answer_summary: item.answer_summary,
            assessment: item.coaching_note,
            evidence_quote: item.evidence_quotes[0],
            score: item.score
        }));
        const feedback = {
            evaluation_version: 'v3_readiness_scorecard',
            overall_score: 87,
            grade: { grade: 'A', label: 'Demo-ready', color: '#4ade80', score: 87 },
            interview_scores: interviewScores,
            module_scores: {
                strategic_thinking: 88,
                cross_functional_leadership: 89,
                product_sense: 86
            },
            competency_scores: competencyScores,
            pillars: {
                interview: {
                    score: 87,
                    weight: 1,
                    scores: interviewScores,
                    module_scores: {
                        strategic_thinking: 88,
                        cross_functional_leadership: 89,
                        product_sense: 86
                    },
                    competency_scores: competencyScores
                }
            },
            readiness: {
                level: 'interview_ready',
                hire_signal: 'yes',
                summary: 'The candidate gives specific, role-aligned product answers with measurable outcomes and strong cross-functional judgment. The main polish area is sharper executive-level brevity.',
                blockers: ['Executive communication can be more concise under senior-stakeholder pressure.'],
                strongest_signals: [
                    'Quantified product impact with an activation lift.',
                    'Clear prioritization framework tied to user pain, revenue, and effort.',
                    'Handled stakeholder conflict without accepting a one-off roadmap detour.'
                ]
            },
            weakest_area: 'Executive communication brevity',
            strongest_area: 'Evidence-backed product ownership',
            improvement_tip: 'Lead high-stakes answers with the decision and outcome, then support with two or three facts.',
            coaching_summary: 'Strong product-management interview performance. Keep the concrete metrics and cross-functional examples, but compress setup details so senior listeners hear the recommendation faster.',
            actionable_next_steps: [
                'Practice a 90-second STAR answer for the onboarding analytics launch.',
                'Prepare one concise story about roadmap tradeoffs and stakeholder alignment.',
                'Build a 30-60-90 answer with measurable deliverables for each phase.'
            ],
            red_flags: [],
            risk_flags: ['Some answers include extra discovery context before the decision, which may feel less executive-ready.'],
            practice_plan: [
                'Record the product launch answer twice: once in 120 seconds and once in 75 seconds.',
                'Create three executive-first answer openings: decision, outcome, evidence.',
                'Run a stakeholder-conflict drill where you name the tradeoff, decision owner, and reusable product lesson.'
            ],
            question_evaluations: questionEvaluations,
            question_highlights: questionHighlights,
            transcript_features: {
                question_count: 5,
                answer_count: 5,
                missing_answer_count: 0,
                timeout_count: 0,
                total_word_count: 180,
                avg_word_count: 36,
                min_word_count: 28,
                max_word_count: 46,
                avg_response_time_seconds: 52
            },
            evaluator_confidence: 92
        };

        return {
            id: 'demo-v3-product-manager',
            date: new Date().toISOString(),
            target_role: 'Product Manager, AI Collaboration Tools',
            module: 'general',
            duration_seconds: 780,
            messages,
            feedback
        };
    }

    window.loadDemoReport = async function () {
        const demo = createDemoSession();
        state.currentSessionId = demo.id;
        state.targetRole = demo.target_role;
        state.selectedModule = demo.module;
        state.chatHistory = demo.messages;
        state.lastSessionFeedback = demo.feedback;
        state.sessionHistoryCache = null;

        try {
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(demo)
            });
            if (!res.ok) throw new Error(`Demo session save failed: ${res.status}`);
        } catch (error) {
            console.warn('Demo session could not be saved to history:', error);
        }

        navigate('report');
    };

    // --- Jargon Check Constants ---
    const JARGON_TERMS = [
        'kubernetes', 'k8s', 'docker', 'containerization', 'microservices', 'kafka', 'rabbitmq',
        'o(n log n)', 'o(n)', 'big-o', 'asymptotic', 'tcp/ip', 'osi model', 'cicd', 'ci/cd',
        'terraform', 'ansible', 'helm chart', 'etcd', 'grpc', 'protobuf', 'websocket', 'oauth2',
        'jwt token', 'nosql', 'redis', 'elasticsearch', 'graphql mutation', 'react hooks',
        'memoization', 'recursion stack', 'binary tree', 'linked list', 'heap sort', 'dijkstra',
        'lambda function', 'vpc', 'subnet', 'elastic load balancer', 's3 bucket', 'ec2 instance'
    ];
    // Modules where jargon is flagged (non-technical audiences)
    const JARGON_FLAGGED_MODULES = ['general', 'roleplay', 'casestudy'];

    // --- Industry Customization Constants ---
    const INDUSTRIES = [
        { id: 'general', icon: 'world', label: 'General', desc: 'Balanced across all sectors' },
        { id: 'software', icon: 'device-desktop-code', label: 'Software Eng.', desc: 'Engineering culture & systems' },
        { id: 'healthcare', icon: 'heart-pulse', label: 'Healthcare', desc: 'Clinical, HIPAA & compliance' },
        { id: 'finance', icon: 'chart-line', label: 'Finance', desc: 'Regulatory & analytical focus' },
        { id: 'creative', icon: 'palette', label: 'Creative', desc: 'Portfolio & design thinking' },
        { id: 'sales', icon: 'handshake', label: 'Sales', desc: 'Quota, pipeline & persuasion' },
    ];

    // --- Global Camera Functions ---
    async function startCamera() {
        const video = document.getElementById('self-camera-preview');
        const offOverlay = document.getElementById('camera-off-overlay');
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            state.cameraStream = stream;
            if (video) {
                video.srcObject = stream;
                video.onloadedmetadata = () => video.play();
            }
        } catch (err) {
            console.error("Camera access denied:", err);
            if (offOverlay) offOverlay.classList.remove('hidden');
            state.cameraEnabled = false;
        }
    }

    function stopCamera() {
        if (state.cameraStream) {
            state.cameraStream.getTracks().forEach(track => track.stop());
            state.cameraStream = null;
        }
    }

    // --- Engagement Score Calculator ----------------------
    // Computed from session metadata at end - no LLM needed
    function buildEngagementMetrics() {
        const messages = state.chatHistory || [];
        const userMsgs = messages.filter(m => m.role === 'user' && !m.isTyping);
        if (userMsgs.length < 2) return { composite: 0 };

        // Ideal word ranges per module
        const idealRanges = {
            general: [80, 200], technical: [50, 150], roleplay: [60, 180],
            visual: [100, 250], casestudy: [120, 300], salary: [40, 120]
        };
        const [minIdeal, maxIdeal] = idealRanges[state.selectedModule] || [80, 200];

        // Word counts per response
        const wordCounts = userMsgs.map(m => (m.content || '').split(/\s+/).filter(Boolean).length);
        const avgWords = wordCounts.reduce((a, b) => a + b, 0) / wordCounts.length;

        // Response time (using timestamps if available, otherwise estimate)
        const responseTimes = [];
        for (let i = 0; i < messages.length; i++) {
            if (messages[i].role === 'user' && messages[i].timestamp && i > 0) {
                const prevMsg = messages.slice(0, i).reverse().find(m => m.role === 'assistant');
                if (prevMsg && prevMsg.timestamp) {
                    responseTimes.push((messages[i].timestamp - prevMsg.timestamp) / 1000);
                }
            }
        }
        const avgRespTime = responseTimes.length > 0
            ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
            : 5; // default if no timestamps

        // 1. Response Time Score (30%)
        let timeScore;
        if (avgRespTime < 1) timeScore = 60;
        else if (avgRespTime <= 3) timeScore = 90;
        else if (avgRespTime <= 8) timeScore = 100;
        else if (avgRespTime <= 15) timeScore = 70;
        else if (avgRespTime <= 30) timeScore = 40;
        else timeScore = 20;

        // 2. Response Length Score (25%)
        let lengthScore;
        if (avgWords >= minIdeal && avgWords <= maxIdeal) lengthScore = 100;
        else if (avgWords < minIdeal) lengthScore = Math.max(20, Math.round((avgWords / minIdeal) * 100));
        else lengthScore = Math.max(40, Math.round(100 - ((avgWords - maxIdeal) / maxIdeal) * 40));

        // 3. Consistency Score (25%)
        const wcMean = avgWords;
        const wcVariance = wordCounts.reduce((sum, w) => sum + (w - wcMean) ** 2, 0) / wordCounts.length;
        const wcStdDev = Math.sqrt(wcVariance);
        const consistencyScore = Math.max(0, Math.round(100 - wcStdDev * 2));

        // 4. Improvement Trajectory (20%)
        const third = Math.floor(wordCounts.length / 3);
        let trajectoryScore = 75;
        if (third >= 1) {
            const firstThird = wordCounts.slice(0, third);
            const lastThird = wordCounts.slice(-third);
            const firstAvg = firstThird.reduce((a, b) => a + b, 0) / firstThird.length;
            const lastAvg = lastThird.reduce((a, b) => a + b, 0) / lastThird.length;
            const ratio = firstAvg > 0 ? lastAvg / firstAvg : 1;
            if (ratio > 1.1) trajectoryScore = Math.min(100, 90 + Math.round((ratio - 1.1) * 50));
            else if (ratio >= 0.9) trajectoryScore = 75;
            else if (ratio >= 0.7) trajectoryScore = 55;
            else trajectoryScore = 30;
        }

        const composite = Math.round(
            timeScore * 0.30 +
            lengthScore * 0.25 +
            consistencyScore * 0.25 +
            trajectoryScore * 0.20
        );

        return {
            composite: Math.max(0, Math.min(100, composite)),
            response_time: Math.max(0, Math.min(100, timeScore)),
            response_length: Math.max(0, Math.min(100, lengthScore)),
            consistency: Math.max(0, Math.min(100, consistencyScore)),
            trajectory: Math.max(0, Math.min(100, trajectoryScore)),
            avg_response_time_seconds: Math.round(avgRespTime * 10) / 10,
            avg_word_count: Math.round(avgWords),
        };
    }

    // --- Presence HUD (live body language overlay) --------
    let presenceHudInterval = null;

    function showPresenceHUD() {
        // Create small floating HUD near the camera preview
        let hud = document.getElementById('presence-hud');
        if (hud) return; // already showing

        hud = document.createElement('div');
        hud.id = 'presence-hud';
        hud.innerHTML = `
            <div class="phud-title">${ti('chart-bar')} Presence</div>
            <div class="phud-row"><span class="phud-ico">${ti('eye')}</span><span class="phud-label">Eye</span><span class="phud-bar"><span class="phud-fill" id="phud-eye"></span></span><span class="phud-val" id="phud-eye-val">--</span></div>
            <div class="phud-row"><span class="phud-ico">${ti('run')}</span><span class="phud-label">Posture</span><span class="phud-bar"><span class="phud-fill" id="phud-posture"></span></span><span class="phud-val" id="phud-posture-val">--</span></div>
            <div class="phud-row"><span class="phud-ico">${ti('hand-finger')}</span><span class="phud-label">Gesture</span><span class="phud-bar"><span class="phud-fill" id="phud-gesture"></span></span><span class="phud-val" id="phud-gesture-val">--</span></div>
        `;        const style = document.createElement('style');
        style.id = 'presence-hud-style';
        style.textContent = `
            #presence-hud {
                position: fixed; bottom: 16px; right: 16px; z-index: 9999;
                background: rgba(15,15,25,0.88); backdrop-filter: blur(12px);
                border: 1px solid rgba(255,255,255,0.08); border-radius: 12px;
                padding: 10px 14px; min-width: 180px;
                font-family: 'Inter', sans-serif; font-size: 11px; color: #e0e0e0;
                box-shadow: 0 4px 24px rgba(0,0,0,0.4);
                transition: opacity 0.3s;
            }
            .phud-title { font-weight: 700; font-size: 11px; color: #a0a0b0; margin-bottom: 6px; letter-spacing: 0.5px; display:flex; align-items:center; gap:6px; }
            .phud-row { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
            .phud-ico { font-size: 13px; width: 16px; text-align: center; display:inline-flex; align-items:center; justify-content:center; }
            .phud-label { width: 50px; font-size: 10px; color: #888; }
            .phud-bar { flex: 1; height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; }
            .phud-fill { height: 100%; border-radius: 2px; transition: width 0.5s ease, background 0.5s ease; }
            .phud-val { width: 24px; text-align: right; font-weight: 600; font-size: 10px; }
        `;
        document.head.appendChild(style);
        document.body.appendChild(hud);

        // Update every 2 seconds
        presenceHudInterval = setInterval(() => {
            if (!window.BodyLanguageAnalyzer || !window.BodyLanguageAnalyzer.isActive()) return;
            const m = window.BodyLanguageAnalyzer.getRealtimeMetrics();
            if (!m) return;

            updateHudBar('phud-eye', m.eye_contact);
            updateHudBar('phud-posture', m.posture);
            updateHudBar('phud-gesture', m.gestures);
        }, 2000);
    }

    function updateHudBar(id, value) {
        const fill = document.getElementById(id);
        const val = document.getElementById(id + '-val');
        if (!fill || !val) return;
        fill.style.width = value + '%';
        fill.style.background = value >= 70 ? '#4ade80' : value >= 45 ? '#fbbf24' : '#ef4444';
        val.textContent = value;
        val.style.color = value >= 70 ? '#4ade80' : value >= 45 ? '#fbbf24' : '#ef4444';
    }

    function hidePresenceHUD() {
        if (presenceHudInterval) { clearInterval(presenceHudInterval); presenceHudInterval = null; }
        const hud = document.getElementById('presence-hud');
        const style = document.getElementById('presence-hud-style');
        if (hud) hud.remove();
        if (style) style.remove();
    }

    const modules = [
        {
            id: "general", icon: "layers-intersect", title: "General Interview",
            description: "A well-rounded mock interview covering introductions, behavioral questions, career goals, and situational scenarios - ideal for any role.",
            examples: ["Behavioral", "STAR Method", "Career Goals", "Culture Fit", "Introductions"],
            colorClass: "bg-module-general/15 text-module-general", borderColorClass: "border-module-general/20",
        },
        {
            id: "roleplay", icon: "messages", title: "Roleplay & Behavioral",
            description: "Practice with AI personas - angry customers, demanding clients, team conflicts. Get evaluated on tone and de-escalation.",
            examples: ["Conflict Resolution", "De-escalation", "Negotiation", "Client Management", "Team Leadership"],
            colorClass: "bg-module-roleplay/15 text-module-roleplay", borderColorClass: "border-module-roleplay/20",
        },
        {
            id: "visual", icon: "presentation", title: "Visual & Whiteboard",
            description: "Explain designs, sketch architectures, and walk through visual problem-solving. Justify your spatial and creative decisions.",
            examples: ["UI/UX Design", "System Architecture", "Wireframing", "Data Visualization", "Product Design"],
            colorClass: "bg-module-visual/15 text-module-visual", borderColorClass: "border-module-visual/20",
        },
        {
            id: "technical", icon: "code", title: "Technical Assessment",
            description: "Code reviews, bug hunting, system design, and logic puzzles. Demonstrate your engineering thinking under pressure.",
            examples: ["System Design", "Algorithms", "Code Review", "Cloud & DevOps", "Data Engineering"],
            colorClass: "bg-module-technical/15 text-module-technical", borderColorClass: "border-module-technical/20",
        },
        {
            id: "casestudy", icon: "chart-dots-3", title: "Case Study & Strategy",
            description: "Analyze business scenarios, market entry strategies, and operational challenges. Think like a consultant and structure your reasoning.",
            examples: ["Consulting", "Product Strategy", "Market Analysis", "Business Operations", "Problem Frameworks"],
            colorClass: "bg-purple-500/15 text-purple-400", borderColorClass: "border-purple-500/20",
        },
        {
            id: "salary", icon: "cash", title: "Salary Negotiation",
            description: "Practice negotiating your offer with a realistic hiring manager. Know your worth, articulate your value, and leave money on the table for no one.",
            examples: ["Offer Discussion", "Counter Offer", "Benefits", "BATNA", "Anchoring"],
            colorClass: "bg-emerald-500/15 text-emerald-400", borderColorClass: "border-emerald-500/20",
        }
    ];

    const characters = [
        { id: "strict", label: "Strict & Professional", description: "Formal, high standards, expects precise answers", icon: "scale", nudge: "I'm still waiting for your response. Efficiency is key - let's keep the momentum going." },
        { id: "friendly", label: "Friendly & Supportive", description: "Warm, encouraging, builds rapport naturally", icon: "mood-smile", nudge: "Just checking in - take your time, but I'm here when you're ready to share your thoughts!" },
        { id: "stress", label: "Stress Interview", description: "Challenging, rapid-fire, tests composure under pressure", icon: "flame", nudge: "The clock is ticking. Silence doesn't fill the gap. What's your answer?" },
        { id: "calm", label: "Calm & Analytical", description: "Thoughtful, deep follow-ups, values reasoning", icon: "brain", nudge: "It's okay to take a moment to reflect. I'll be here when you're ready." },
        { id: "executive", label: "The Executive Panel", description: "C-suite perspective, tests vision, strategy, and leadership", icon: "tie", nudge: "Let's stay focused. What are your thoughts on this?" },
        { id: "peer", label: "The Peer Interviewer", description: "Casual, team-fit focused, conversational and culture-oriented", icon: "users", nudge: "Hey, still thinking? No worries, just wanted to make sure you're still there." }
    ];
    // Build rich system prompt based on session configuration
    function buildSystemPrompt() {
        const characterPrompts = {
            strict: `You are a strict, formal interviewer with very high standards. You speak professionally, rarely smile, and expect precise, well-structured answers. If the candidate gives a vague answer, you push back firmly. You value clarity, specificity, and evidence-based responses. You may interrupt if answers are too long or off-topic.`,
            friendly: `You are a warm, friendly interviewer who puts candidates at ease. You smile often, give encouraging nods, and build rapport naturally. You ask follow-up questions with genuine curiosity. While supportive, you still probe for depth and substance. You occasionally share brief anecdotes to make the conversation feel natural.`,
            stress: `You are a stress interviewer who deliberately creates pressure. You ask rapid-fire questions, challenge answers immediately, and sometimes express skepticism. You may use silence to create discomfort or ask unexpected curveball questions. Your goal is to test composure, quick thinking, and how candidates perform under pressure. Never be rude or insulting - be professionally challenging.`,
            calm: `You are a calm, analytical interviewer who thinks deeply before responding. You ask thoughtful, layered questions and value reasoning over quick answers. You give candidates time to think and appreciate when they walk through their thought process. You often ask "why" and "how" to go deeper into their reasoning.`,
            executive: `You are a senior executive (VP/C-suite level) conducting a final-round interview. You think in terms of business impact, strategy, and organizational vision. You ask big-picture questions about how the candidate would transform their department, handle board-level decisions, or drive company-wide initiatives. You value strategic thinking, executive presence, and ability to articulate a compelling vision.`,
            peer: `You are a potential teammate conducting a culture-fit interview. You're casual, conversational, and genuinely trying to see if this person would be great to work with daily. You ask about work style, collaboration preferences, and how they handle day-to-day team dynamics. You share some context about the "team" to make it feel authentic. You use a relaxed, first-name-basis tone.`
        };

        const modulePrompts = {
            general: `You are conducting a General Interview. Ask a well-rounded mix of behavioral, situational, and motivational questions. Use the STAR method framework when appropriate.`,
            roleplay: `You are conducting a Roleplay & Behavioral Interview. You will play a character (customer, colleague, or manager) and create realistic conflict or challenge scenarios for the candidate to navigate. Evaluate their communication, empathy, and conflict-resolution skills.`,
            visual: `You are conducting a Visual & Whiteboard Interview. Ask the candidate to verbally walk you through design decisions, system architectures, or UX flows. Since there's no shared canvas, ask them to describe their sketches step-by-step. Probe their spatial reasoning and design thinking.`,
            technical: `You are conducting a Technical Assessment Interview. Ask algorithm, data structure, system design, and code-review questions appropriate to the role. For coding questions, ask the candidate to think aloud and describe their approach.`,
            casestudy: `You are conducting a Case Study & Strategy Interview. Present a business challenge (market entry, operational problem, product launch) and ask the candidate to structure and reason through it like a consultant. Probe their frameworks, assumptions, and recommendations.`,
            salary: `You are playing the role of a Hiring Manager who has just extended a job offer. Your goal is to open with a specific offer (salary, equity, start date, benefits). Be somewhat firm but realistic - you can move 5-15% on base and negotiate on signing bonus and WFH flexibility. Do NOT reveal your BATNA. Push back naturally on counter-offers, but ultimately reward well-reasoned arguments. The session ends when both parties reach an agreement or the candidate declines. Stay in character throughout - never break to give coaching tips.`,
        };

        const difficultyPrompts = {
            easy: `Difficulty: EASY. Ask straightforward questions. Be patient, give hints if the candidate struggles, and keep questions at a foundational level. This is suitable for entry-level or first-time interviewees.`,
            medium: `Difficulty: MEDIUM. Ask moderately challenging questions that require some experience and thought. Balance between testing knowledge and allowing the candidate to demonstrate their skills. Suitable for mid-level professionals.`,
            hard: `Difficulty: HARD. Ask complex, multi-layered questions that require deep expertise. Challenge assumptions, ask for trade-off analysis, and expect nuanced answers. Create time pressure. Suitable for senior-level candidates.`
        };

        const durationSettings = {
            quick: { questions: 5, desc: 'This is a quick 5-question session. Keep questions focused and limit follow-ups. After 5 main questions, wrap up the interview naturally.' },
            standard: { questions: 10, desc: 'This is a standard session with about 10 questions. Balance depth and breadth. Include 2-3 follow-up questions on interesting answers.' },
            extended: { questions: 20, desc: 'This is an extended deep-dive session with about 20 questions. Go deep on topics, ask many follow-ups, and thoroughly explore the candidate\'s experience.' }
        };

        const char = characterPrompts[state.interviewerPersona.character] || characterPrompts.friendly;
        const mod = modulePrompts[state.selectedModule] || modulePrompts.general;
        const diff = difficultyPrompts[state.difficulty] || difficultyPrompts.medium;
        const dur = durationSettings[state.duration] || durationSettings.standard;

        // Industry context prompts
        const industryPrompts = {
            general: ``,
            software: `## Industry Context\nThis is a Software Engineering interview. Reference engineering culture norms: technical depth, code quality, system design at scale, on-call culture, and engineering-driven decision making. Use phrases and concepts natural to software teams.`,
            healthcare: `## Industry Context\nThis is a Healthcare industry interview. Reference HIPAA compliance, patient safety, clinical empathy, care coordination, and regulatory constraints. The candidate may encounter questions about electronic health records, privacy protocols, and cross-functional care teams.`,
            finance: `## Industry Context\nThis is a Finance industry interview. Reference regulatory frameworks (SEC, FINRA, Basel III), risk management, quantitative analysis, fiduciary responsibility, and financial modelling. Expect precision, conservatism, and evidence-based reasoning.`,
            creative: `## Industry Context\nThis is a Creative industry interview. Reference portfolio-based evaluation, design thinking, client briefs, creative iteration, brand consistency, and storytelling. Candidates should be prepared to justify aesthetic decisions and discuss their creative process.`,
            sales: `## Industry Context\nThis is a Sales interview. Reference quota attainment, pipeline management, CRM tools (Salesforce etc.), objection handling, discovery calls, closing techniques, and commission structures. The interviewer values metrics, target orientation, and persuasive communication.`,
        };

        let prompt = `You are an AI interviewer conducting a mock interview session.\n\n`;
        prompt += `## Your Persona\n${char}\n\n`;
        prompt += `## Interview Type\n${mod}\n\n`;
        prompt += `## Role Context\nThe candidate is interviewing for the position of: ${state.targetRole || 'a professional role'}.\n\n`;
        prompt += `## Difficulty & Pacing\n${diff}\n${dur.desc}\n\n`;

        // Industry context (only if not general)
        if (state.industry && state.industry !== 'general' && industryPrompts[state.industry]) {
            prompt += `${industryPrompts[state.industry]}\n\n`;
        }

        // FAANG / Big Tech Filter
        if (state.faangMode) {
            prompt += `## FAANG / Big Tech Mode\nYou are conducting a bar-raiser style interview typical of top-tier tech companies (Google, Meta, Amazon, Apple, Microsoft). Apply the following:\n`;
            prompt += `- For Amazon: Weave in Leadership Principles (Customer Obsession, Bias for Action, Ownership, Dive Deep, Invent & Simplify, etc.). Ask explicitly "Tell me about a time you showed [LP]..." at least twice.\n`;
            prompt += `- For Google: Probe Googleyness - intellectual curiosity, collaborative problem solving, comfort with ambiguity.\n`;
            prompt += `- For Meta: Emphasize "Move Fast", scale challenges, and data-informed decisions.\n`;
            prompt += `- Push back on vague answers. Demand quantifiable impact ("What was the business outcome?").\n`;
            prompt += `- Expect system design at massive scale if the role is technical.\n`;
            prompt += `- The bar is deliberately high - only truly exceptional answers pass.\n\n`;
        }

        if (state.resumeText) {
            prompt += `## Candidate's Resume\nUse this to personalize questions and reference their specific experience:\n${state.resumeText}\n\n`;
        }

        if (state.jobDescription) {
            prompt += `## Job Description\nFocus specifically on these requirements and responsibilities:\n${state.jobDescription}\n\n`;
        }

        prompt += `## Rules\n`;
        prompt += `- Ask ONE question at a time and wait for the candidate's response.\n`;
        prompt += `- Start with a brief, natural greeting appropriate to your persona.\n`;
        prompt += `- Never break character or acknowledge that you are an AI.\n`;
        prompt += `- Adapt your follow-up questions based on the candidate's answers.\n`;
        prompt += `- If the candidate's answer is strong, acknowledge it briefly before moving on.\n`;
        prompt += `- If the candidate's answer is weak or vague, probe deeper or offer gentle guidance to improve.\n`;
        prompt += `- Keep your responses concise (2-4 sentences for questions, 1-2 for transitions).\n`;
        prompt += `- Do not list multiple questions at once.\n`;
        prompt += `- If you see a message starting with '[TIMEOUT]', it means the candidate's time for the previous question has expired. You must acknowledge this naturally and proactively in your persona (e.g., "You're taking so long", "I haven't heard from you in a while", "We need to keep moving"). Do NOT give the answer; instead, immediately proceed to the next question or topic.\n`;

        return prompt;
    }



    // ==========================================================
    // ==========================================================
    // ACHIEVEMENTS SYSTEM (4-Tier: Bronze > Silver > Gold > Platinum)
    // ==========================================================
    const TIER_META = {
        platinum: { label: 'Platinum', icon: 'diamond', sub: 'Reserved for the elite few - near impossible to unlock', color: '#80deea', bg: 'rgba(128,222,234,.07)', bord: 'rgba(128,222,234,.25)' },
        gold: { label: 'Gold', icon: 'medal-2', sub: 'For the truly dedicated - requires serious commitment', color: '#ffd54f', bg: 'rgba(255,213,79,.08)', bord: 'rgba(255,213,79,.28)' },
        silver: { label: 'Silver', icon: 'medal', sub: 'Consistent effort and growing mastery', color: '#b0bec5', bg: 'rgba(176,190,197,.07)', bord: 'rgba(176,190,197,.22)' },
        bronze: { label: 'Bronze', icon: 'award', sub: 'Building the foundation - everyone starts here', color: '#e8975a', bg: 'rgba(232,151,90,.08)', bord: 'rgba(232,151,90,.25)' },
    };
    const LEVELS = [
        { min: 0, name: 'Rookie', next: 100 },
        { min: 100, name: 'Contender', next: 250 },
        { min: 250, name: 'Practitioner', next: 500 },
        { min: 500, name: 'Competitor', next: 850 },
        { min: 850, name: 'Achiever', next: 1300 },
        { min: 1300, name: 'Expert', next: 1900 },
        { min: 1900, name: 'Elite', next: 2700 },
        { min: 2700, name: 'Legend', next: 2700 },
    ];
    function calcXP(earned) { return [...earned].reduce((s, id) => { const b = BADGES.find(b => b.id === id); return s + (b?.xp || 0); }, 0); }
    function getLevel(xp) { let l = 1; LEVELS.forEach((d, i) => { if (xp >= d.min) l = i + 1; }); return l; }

    const BADGES = [
        // -- BRONZE (15 XP each) --
        { id: 'first_steps', tier: 'bronze', icon: 'school', xp: 15, name: 'First Steps', desc: 'You started the journey.', hint: 'Complete 1 session' },
        { id: 'speed_run', tier: 'bronze', icon: 'bolt', xp: 15, name: 'Speed Run', desc: 'Fast and focused.', hint: 'Complete a Quick session' },
        { id: 'people_person', tier: 'bronze', icon: 'handshake', xp: 15, name: 'People Person', desc: 'Mastered the human side of interviews.', hint: 'Complete a Roleplay session' },
        { id: 'tech_minded', tier: 'bronze', icon: 'device-desktop-code', xp: 15, name: 'Tech Minded', desc: 'Comfortable with technical depth.', hint: 'Complete a Technical session' },
        { id: 'creative_thinker', tier: 'bronze', icon: 'palette', xp: 15, name: 'Creative Thinker', desc: 'Thinks visually and spatially.', hint: 'Complete a Visual session' },
        { id: 'strategist', tier: 'bronze', icon: 'chart-dots-3', xp: 15, name: 'Strategist', desc: 'Can analyze a business case under pressure.', hint: 'Complete a Case Study session' },
        { id: 'salary_starter', tier: 'bronze', icon: 'cash-banknote', xp: 15, name: 'Salary Starter', desc: 'Started learning the art of negotiation.', hint: 'Complete a Salary Negotiation session' },
        { id: 'professional', tier: 'bronze', icon: 'briefcase', xp: 15, name: 'Professional', desc: 'Came prepared with a resume.', hint: 'Upload a resume before a session' },
        // -- SILVER (50 XP each) --
        { id: 'coming_back', tier: 'silver', icon: 'refresh', xp: 50, name: 'Coming Back', desc: 'You keep showing up - that is the real skill.', hint: 'Complete 5 sessions' },
        { id: 'regular', tier: 'silver', icon: 'calendar', xp: 50, name: 'Regular', desc: 'Practice makes perfect.', hint: 'Complete 10 sessions' },
        { id: 'sharp_shooter', tier: 'silver', icon: 'target-arrow', xp: 50, name: 'Sharp Shooter', desc: 'No hesitation, no timeouts.', hint: 'Finish a session with no timeouts' },
        { id: 'explorer', tier: 'silver', icon: 'compass', xp: 50, name: 'Explorer', desc: 'Tried 4 different interview styles.', hint: 'Complete sessions in 4 different modules' },
        { id: 'marathon_runner', tier: 'silver', icon: 'run', xp: 50, name: 'Marathon Runner', desc: 'Went the full distance.', hint: 'Complete an Extended session' },
        { id: 'b_club', tier: 'silver', icon: 'letter-b', xp: 50, name: 'B+ Club', desc: 'Solid performance territory.', hint: 'Score 80%+ in any session' },
        { id: 'salary_savvy', tier: 'silver', icon: 'pig-money', xp: 50, name: 'Salary Savvy', desc: 'Learning to hold your ground in negotiations.', hint: 'Complete 3 Salary Negotiation sessions' },
        { id: 'comeback_kid', tier: 'silver', icon: 'trending-up', xp: 50, name: 'Comeback Kid', desc: 'Turned things around with a strong follow-up.', hint: 'Improve score by 15+ points vs last session' },
        // -- GOLD (150 XP each) --
        { id: 'veteran', tier: 'gold', icon: 'medal', xp: 150, name: 'Veteran', desc: '20 sessions in. You\'re putting in the work.', hint: 'Complete 20 sessions' },
        { id: 'faang_aspirant', tier: 'gold', icon: 'building-skyscraper', xp: 150, name: 'FAANG Aspirant', desc: 'Has faced the bar-raiser multiple times.', hint: 'Complete 3 FAANG mode sessions' },
        { id: 'industry_expert', tier: 'gold', icon: 'world', xp: 150, name: 'Industry Expert', desc: 'Fluent across every sector.', hint: 'Try all 6 industry styles' },
        { id: 'all_rounder', tier: 'gold', icon: 'stars', xp: 150, name: 'All-Rounder', desc: 'Conquered every interview format.', hint: 'Complete a session in every module' },
        { id: 'on_the_rise', tier: 'gold', icon: 'rocket', xp: 150, name: 'On the Rise', desc: 'Massive improvement in a single leap.', hint: 'Improve score by 25+ points vs last session' },
        { id: 'a_player', tier: 'gold', icon: 'crown', xp: 150, name: 'A Player', desc: 'Consistently delivering high quality answers.', hint: 'Score 90%+ in 3 different sessions' },
        { id: 'speed_demon', tier: 'gold', icon: 'wind', xp: 150, name: 'Speed Demon', desc: 'Five blitz sessions, zero hesitation.', hint: 'Complete 5 Quick sessions' },
        // -- PLATINUM (400 XP each) --
        { id: 'perfect_score', tier: 'platinum', icon: 'circle-check', xp: 400, name: 'Perfect Score', desc: 'A flawless performance. Virtually impossible.', hint: 'Score 100% in any session' },
        { id: 'diamond_standard', tier: 'platinum', icon: 'diamond', xp: 400, name: 'Diamond Standard', desc: '50 sessions. Unmatched dedication.', hint: 'Complete 50 sessions' },
        { id: 'elite_performer', tier: 'platinum', icon: 'flame', xp: 400, name: 'Elite Performer', desc: 'Consistently exceptional across 5 sessions.', hint: 'Score 90%+ in 5 consecutive sessions' },
        { id: 'chameleon', tier: 'platinum', icon: 'layers-intersect', xp: 400, name: 'Chameleon', desc: 'True mastery - every format, hardest setting.', hint: 'Complete all 6 modules on Hard difficulty' },
    ];

    // Derives which badge IDs are currently earned given session history
    async function computeBadges() {
        let sessions = [];
        try {
            const res = await fetch('/api/sessions');
            const data = await res.json();
            sessions = data.sessions || [];
        } catch (e) { sessions = []; }

        const scored = sessions.filter(s => s.feedback && typeof s.feedback.overall_score === 'number');
        const totalSessions = sessions.length;
        const scores = scored.map(s => s.feedback.overall_score);

        const modulesUsed = new Set(sessions.map(s => s.module));
        const hasResume = sessions.some(s => s.resume_used);
        const quickSessions = sessions.filter(s => s.duration === 'quick' || (s.duration_seconds && s.duration_seconds < 300)).length;
        const extendedSessions = sessions.filter(s => s.duration === 'extended').length;
        const faangSessions = JSON.parse(localStorage.getItem('ai_coach_faang_sessions') || '0');
        const industriesUsed = new Set(JSON.parse(localStorage.getItem('ai_coach_industries_used') || '[]'));
        const noTimeoutSessions = JSON.parse(localStorage.getItem('ai_coach_no_timeout_sessions') || '0');
        const salarySessions = sessions.filter(s => s.module === 'salary').length;

        // 5 consecutive 90+ check
        let consec90 = 0, maxConsec90 = 0;
        [...scored].reverse().forEach(s => {
            if (s.feedback.overall_score >= 90) { consec90++; maxConsec90 = Math.max(maxConsec90, consec90); }
            else consec90 = 0;
        });

        // Count distinct sessions with 90+
        const sessions90 = new Set(scored.filter(s => s.feedback.overall_score >= 90).map(s => s.session_id || s.id)).size;

        // Comeback Kid: last two sessions differ by 15+
        let comebackKid = false;
        if (scores.length >= 2) comebackKid = (scores[scores.length - 1] - scores[scores.length - 2]) >= 15;

        // On the Rise: last two sessions differ by 25+
        let onTheRise = false;
        if (scores.length >= 2) onTheRise = (scores[scores.length - 1] - scores[scores.length - 2]) >= 25;

        // Hard mode modules completed
        const hardModules = new Set(sessions.filter(s => s.difficulty === 'hard').map(s => s.module));

        const earned = new Set();
        // Bronze
        if (totalSessions >= 1) earned.add('first_steps');
        if (quickSessions >= 1) earned.add('speed_run');
        if (modulesUsed.has('roleplay')) earned.add('people_person');
        if (modulesUsed.has('technical')) earned.add('tech_minded');
        if (modulesUsed.has('visual')) earned.add('creative_thinker');
        if (modulesUsed.has('casestudy')) earned.add('strategist');
        if (modulesUsed.has('salary')) earned.add('salary_starter');
        if (hasResume) earned.add('professional');
        // Silver
        if (totalSessions >= 5) earned.add('coming_back');
        if (totalSessions >= 10) earned.add('regular');
        if (noTimeoutSessions >= 1) earned.add('sharp_shooter');
        if (modulesUsed.size >= 4) earned.add('explorer');
        if (extendedSessions >= 1) earned.add('marathon_runner');
        if (scores.some(s => s >= 80)) earned.add('b_club');
        if (salarySessions >= 3) earned.add('salary_savvy');
        if (comebackKid) earned.add('comeback_kid');
        // Gold
        if (totalSessions >= 20) earned.add('veteran');
        if (faangSessions >= 3) earned.add('faang_aspirant');
        if (industriesUsed.size >= 6) earned.add('industry_expert');
        if (['general', 'roleplay', 'visual', 'technical', 'casestudy', 'salary'].every(m => modulesUsed.has(m))) earned.add('all_rounder');
        if (onTheRise) earned.add('on_the_rise');
        if (sessions90 >= 3) earned.add('a_player');
        if (quickSessions >= 5) earned.add('speed_demon');
        // Platinum
        if (scores.some(s => s >= 100)) earned.add('perfect_score');
        if (totalSessions >= 50) earned.add('diamond_standard');
        if (maxConsec90 >= 5) earned.add('elite_performer');
        if (['general', 'roleplay', 'visual', 'technical', 'casestudy', 'salary'].every(m => hardModules.has(m))) earned.add('chameleon');

        return earned;
    }


    // --- Achievement Sound Engine (Web Audio API - no external files) ---
    function playAchievementSound(tier) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const master = ctx.createGain();
            master.gain.setValueAtTime(0.18, ctx.currentTime);
            master.connect(ctx.destination);

            const note = (freq, startT, dur, vol = 1, type = 'sine') => {
                const osc = ctx.createOscillator();
                const g = ctx.createGain();
                osc.type = type;
                osc.frequency.setValueAtTime(freq, ctx.currentTime + startT);
                g.gain.setValueAtTime(0, ctx.currentTime + startT);
                g.gain.linearRampToValueAtTime(vol, ctx.currentTime + startT + 0.02);
                g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + startT + dur);
                osc.connect(g); g.connect(master);
                osc.start(ctx.currentTime + startT);
                osc.stop(ctx.currentTime + startT + dur + 0.05);
            };

            if (tier === 'bronze') {
                note(880, 0.00, 0.55, 1.0, 'sine');
                note(1108, 0.12, 0.55, 0.8, 'sine');
                setTimeout(() => ctx.close(), 1200);
            } else if (tier === 'silver') {
                master.gain.setValueAtTime(0.20, ctx.currentTime);
                note(659, 0.00, 0.5, 1.0, 'sine');
                note(784, 0.10, 0.5, 0.9, 'sine');
                note(988, 0.22, 0.55, 0.7, 'sine');
                setTimeout(() => ctx.close(), 1500);
            } else if (tier === 'gold') {
                master.gain.setValueAtTime(0.22, ctx.currentTime);
                const seq = [523, 659, 784, 1047];
                seq.forEach((f, i) => {
                    note(f, i * 0.12, 0.5, 1.0, 'sine');
                    note(f * 2, i * 0.12, 0.4, 0.25, 'sine');
                });
                note(523, 0.54, 0.9, 0.5, 'sine');
                note(659, 0.54, 0.9, 0.4, 'sine');
                note(784, 0.54, 0.9, 0.3, 'sine');
                setTimeout(() => ctx.close(), 2000);
            } else { // platinum
                master.gain.setValueAtTime(0.28, ctx.currentTime);
                const arp = [261, 329, 392, 523, 659, 784, 1047, 1319];
                arp.forEach((f, i) => {
                    note(f, i * 0.08, 0.9, 1.0, 'sine');
                    note(f * 1.5, i * 0.08, 0.7, 0.25, 'sine');
                });
                const bloom = [261, 329, 392, 523, 659, 784, 1047];
                bloom.forEach(f => { note(f, 0.72, 2.2, 0.6, 'sine'); });
                [2093, 2637, 3136].forEach((f, i) => { note(f, 0.72 + i * 0.06, 1.8, 0.12, 'sine'); });
                note(65, 0.0, 0.4, 0.9, 'sine');
                note(65, 0.0, 0.25, 0.7, 'triangle');
                setTimeout(() => ctx.close(), 4000);
            }
        } catch (e) { /* AudioContext not available */ }
    }


    // Show slide-down achievement notification banner (queued for multiple)
    function showBadgeNotifications(newlyEarned) {
        const queue = [...newlyEarned];
        const NOTIF_STYLES = {
            platinum: 'background:rgba(128,222,234,.12);border:1px solid rgba(128,222,234,.4);box-shadow:0 8px 32px -4px rgba(128,222,234,.2)',
            gold: 'background:rgba(255,213,79,.1);border:1px solid rgba(255,213,79,.35);box-shadow:0 8px 32px -4px rgba(255,213,79,.2)',
            silver: 'background:rgba(176,190,197,.1);border:1px solid rgba(176,190,197,.3);box-shadow:0 8px 32px -4px rgba(176,190,197,.15)',
            bronze: 'background:rgba(232,151,90,.1);border:1px solid rgba(232,151,90,.3);box-shadow:0 8px 32px -4px rgba(232,151,90,.15)',
        };
        const TIER_LABEL_COLOR = { platinum: '#80deea', gold: '#ffd54f', silver: '#b0bec5', bronze: '#e8975a' };
        const showNext = () => {
            if (!queue.length) return;
            const badgeId = queue.shift();
            const badge = BADGES.find(b => b.id === badgeId);
            if (!badge) { showNext(); return; }

            playAchievementSound(badge.tier);

            const el = document.createElement('div');
            el.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:9999;width:100%;max-width:28rem;padding:12px 16px';
            el.innerHTML = `
                <div style="display:flex;align-items:center;gap:12px;padding:16px;border-radius:14px;cursor:pointer;
                    ${NOTIF_STYLES[badge.tier] || NOTIF_STYLES.bronze};
                    transform:translateY(-120%);transition:transform 0.4s cubic-bezier(0.34,1.56,0.64,1)"
                    onclick="window.nav('achievements')" class="badge-notification">
                    <span style="font-size:1.8rem;flex-shrink:0">${ti(badge.icon)}</span>
                    <div style="flex:1;min-width:0">
                        <div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${TIER_LABEL_COLOR[badge.tier]};margin-bottom:2px">
                            ${badge.tier} achievement unlocked
                        </div>
                        <div style="font-weight:700;color:var(--t-heading);font-size:14px">${badge.name}</div>
                        <div style="font-size:12px;color:var(--t-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${badge.desc}</div>
                    </div>
                    <span style="font-size:11px;color:#555;flex-shrink:0">Tap to view</span>
                </div>
            `;
            document.body.appendChild(el);
            const inner = el.querySelector('.badge-notification');
            requestAnimationFrame(() => requestAnimationFrame(() => { inner.style.transform = 'translateY(0)'; }));
            setTimeout(() => {
                inner.style.transform = 'translateY(-120%)';
                setTimeout(() => { el.remove(); showNext(); }, 450);
            }, 3500);
        };
        showNext();
    }

    // Test helper - call window._testBadge('bronze'|'silver'|'gold'|'platinum') in browser console
    window._testBadge = (tier) => {
        const badge = BADGES.find(b => b.tier === tier);
        if (badge) showBadgeNotifications([badge.id]);
    };


    // Full Achievements page renderer
    async function renderAchievements() {
        mainContent.innerHTML = `<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--t-bg-solid)"><div style="width:24px;height:24px;border:2px solid #e8975a;border-top-color:transparent;border-radius:50%;animation:spin 1s linear infinite"></div></div>`;
        const earned = await computeBadges();
        const totalXP = calcXP(earned);
        const lvl = getLevel(totalXP);
        const ld = LEVELS[lvl - 1];
        const xpPct = ld.next > ld.min ? Math.round(((totalXP - ld.min) / (ld.next - ld.min)) * 100) : 100;
        const earnedCount = BADGES.filter(b => earned.has(b.id)).length;

        mainContent.innerHTML = `
            <style>
                .ach-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);font-family:'Inter',system-ui,sans-serif;color:var(--t-fg);overflow-x:hidden}
                .ach-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
                .ach-orb{position:absolute;border-radius:50%;filter:blur(100px)}
                .ach-o1{width:700px;height:700px;background:hsla(30,70%,50%,.05);top:-250px;left:-200px;animation:achd1 20s ease-in-out infinite}
                .ach-o2{width:500px;height:500px;background:hsla(270,80%,65%,.07);bottom:-150px;right:-120px;animation:achd2 24s ease-in-out infinite}
                .ach-o3{width:420px;height:420px;background:hsla(190,80%,60%,.06);top:40%;right:15%;animation:achd3 28s ease-in-out infinite}
                @keyframes achd1{0%,100%{transform:translate(0,0)}50%{transform:translate(80px,60px)}}
                @keyframes achd2{0%,100%{transform:translate(0,0)}50%{transform:translate(-70px,-80px)}}
                @keyframes achd3{0%,100%{transform:translate(0,0)}50%{transform:translate(50px,-60px)}}
                .ach-page{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:40px 36px 80px}
                .ach-topbar{display:flex;align-items:center;justify-content:space-between;margin-bottom:36px}
                .ach-back{font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;transition:color .2s;padding:0;display:inline-flex;align-items:center;gap:7px}
                .ach-back:hover{color:var(--t-fg)}
                .ach-counter{font-size:13px;font-weight:600;color:var(--t-muted)}
                .ach-counter b{color:var(--t-fg)}
                .ach-hero{display:grid;grid-template-columns:auto 1fr auto;gap:32px;align-items:center;background:var(--t-surface);border:1px solid var(--t-border);border-radius:22px;padding:32px;margin-bottom:32px;position:relative;overflow:hidden}
                .ach-hero-bg{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 120%,rgba(255,213,79,.05),transparent 70%);pointer-events:none}
                .lvl-ring{position:relative;width:120px;height:120px;flex-shrink:0}
                .lvl-ring svg{position:absolute;inset:0;transform:rotate(-90deg)}
                .lvl-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px}
                .lvl-num{font-size:28px;font-weight:900;color:var(--t-heading)}
                .lvl-lbl{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted)}
                .ach-info .ach-title{font-size:2rem;font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:4px}
                .ach-info .ach-sub{font-size:14px;color:var(--t-muted);margin-bottom:18px}
                .xp-row{display:flex;justify-content:space-between;font-size:11px;font-weight:600;color:var(--t-muted);margin-bottom:6px}
                .xp-row .xp-next{color:#ffd54f}
                .xp-bg{height:8px;background:var(--t-bar-track);border-radius:99px;overflow:hidden}
                .xp-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#e8975a,#ffd54f,#80deea);box-shadow:0 0 14px rgba(255,213,79,.35);transition:width 1.2s cubic-bezier(.4,0,.2,1)}
                .ach-stats{display:flex;flex-direction:column;gap:14px;align-items:flex-end;text-align:right}
                .ach-stat-val{font-size:1.6rem;font-weight:800;letter-spacing:-.02em}
                .ach-stat-lbl{font-size:11px;color:var(--t-muted)}
                .ach-sec-hdr{display:flex;align-items:center;margin-bottom:14px}
                .ach-sec-title{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted)}
                .recent-strip{display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;margin-bottom:32px;scrollbar-width:none}
                .recent-strip::-webkit-scrollbar{display:none}
                .mini-badge{flex-shrink:0;width:72px;display:flex;flex-direction:column;align-items:center;gap:6px;padding:12px 8px;border-radius:14px;border:1px solid var(--t-border2);background:var(--t-surface);transition:transform .2s;cursor:default}
                .mini-badge:hover{transform:translateY(-3px)}
                .mini-ico{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:22px}
                .mini-name{font-size:9px;font-weight:700;text-align:center;line-height:1.3}
                .tier-section{margin-bottom:36px}
                .tier-header{display:flex;align-items:center;gap:12px;padding:16px 20px;border-radius:14px 14px 0 0;border:1px solid var(--t-border2);border-bottom:none;background:var(--t-surface)}
                .tier-icon{font-size:22px}
                .tier-info{flex:1}
                .tier-name{font-size:14px;font-weight:800;letter-spacing:-.01em}
                .tier-sub{font-size:11px;color:var(--t-muted);margin-top:2px}
                .tier-pill{font-size:11px;font-weight:700;padding:3px 12px;border-radius:99px;border:1px solid}
                .tier-prog-wrap{width:100px;margin-left:14px}
                .tier-prog-lbl{font-size:10px;font-weight:600;color:var(--t-muted);margin-bottom:4px;text-align:right}
                .tier-prog-bg{height:5px;background:var(--t-border);border-radius:99px;overflow:hidden}
                .tier-prog-fill{height:100%;border-radius:99px;transition:width 1s ease}
                .badges-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(175px,1fr));gap:12px;padding:16px;background:rgba(0,0,0,.18);border:1px solid var(--t-border2);border-radius:0 0 14px 14px}
                .badge-card{border-radius:16px;border:1px solid var(--t-border);background:var(--t-surface);padding:20px 16px 16px;display:flex;flex-direction:column;align-items:center;text-align:center;position:relative;overflow:hidden;transition:all .3s;cursor:default}
                .badge-card.earned{cursor:pointer}
                .badge-card.earned:hover{transform:translateY(-4px)}
                .badge-card.locked{opacity:.5;filter:grayscale(.55)}
                .badge-shell{width:64px;height:64px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;margin-bottom:12px;position:relative;flex-shrink:0}
                .badge-ring{position:absolute;inset:0;border-radius:50%;border:2px solid}
                .badge-glow{position:absolute;inset:-4px;border-radius:50%;filter:blur(8px);opacity:0;transition:opacity .3s}
                .badge-card.earned:hover .badge-glow{opacity:.5}
                .lock-ov{position:absolute;inset:0;border-radius:50%;background:var(--t-surface);display:flex;align-items:center;justify-content:center;font-size:18px}
                .badge-nm{font-size:13px;font-weight:700;color:var(--t-fg);margin-bottom:4px}
                .badge-card.locked .badge-nm{color:var(--t-muted)}
                .badge-ds{font-size:11px;color:var(--t-muted);line-height:1.5}
                .badge-ht{font-size:10px;color:var(--t-muted);line-height:1.5;font-style:italic}
                .xp-tag{margin-top:10px;font-size:10px;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid}
                .earned-tag{position:absolute;top:10px;right:10px;font-size:9px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border-radius:99px}
                @keyframes ach-shimmer{0%{transform:translateX(-100%)}100%{transform:translateX(200%)}}
                .badge-card.earned::after{content:'';position:absolute;top:0;left:-100%;width:60%;height:100%;background:linear-gradient(90deg,transparent,var(--t-surface),transparent);animation:ach-shimmer 3.5s ease-in-out infinite}
                .badge-card.earned.plat::after{background:linear-gradient(90deg,transparent,rgba(128,222,234,.07),transparent);animation:ach-shimmer 2.5s ease-in-out infinite}
                .plat-sparkle{position:absolute;pointer-events:none}
                .plat-sparkle::before,.plat-sparkle::after{content:'\\2726';position:absolute;font-size:9px;color:rgba(128,222,234,.35);animation:sp-float 4s ease-in-out infinite}
                .plat-sparkle::before{top:6px;left:10px}
                .plat-sparkle::after{top:14px;right:8px;animation-delay:1.8s;font-size:7px}
                @keyframes sp-float{0%,100%{opacity:.2;transform:translateY(0)}50%{opacity:.75;transform:translateY(-5px)}}
                @media(max-width:768px){.ach-hero{grid-template-columns:1fr;text-align:center;gap:20px}.ach-stats{flex-direction:row;justify-content:center;gap:24px}.lvl-ring{margin:0 auto}}
            </style>

            <div class="ach-wrap">
                <div class="ach-orbs"><div class="ach-orb ach-o1"></div><div class="ach-orb ach-o2"></div><div class="ach-orb ach-o3"></div></div>
                ${starsHTML('ach-stars')}
                <div class="ach-page">
                    <div class="ach-topbar">
                        <button class="ach-back" onclick="window.nav('hero')">${ti('arrow-left')} Back to Home</button>
                        <div class="ach-counter"><b>${earnedCount}</b> / ${BADGES.length} badges unlocked</div>
                    </div>

                    <div class="ach-hero">
                        <div class="ach-hero-bg"></div>
                        <div class="lvl-ring">
                            <svg viewBox="0 0 120 120">
                                <circle cx="60" cy="60" r="52" fill="none" stroke="var(--t-border)" stroke-width="8"/>
                                <circle cx="60" cy="60" r="52" fill="none" stroke="url(#achLvlGrad)" stroke-width="8"
                                    stroke-linecap="round" id="ach-ring-fill"
                                    stroke-dasharray="326.7" stroke-dashoffset="326.7"
                                    style="filter:drop-shadow(0 0 5px rgba(255,213,79,.4));transition:stroke-dashoffset 1.3s cubic-bezier(.4,0,.2,1)"/>
                                <defs>
                                    <linearGradient id="achLvlGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                                        <stop offset="0%" stop-color="#e8975a"/>
                                        <stop offset="50%" stop-color="#ffd54f"/>
                                        <stop offset="100%" stop-color="#80deea"/>
                                    </linearGradient>
                                </defs>
                            </svg>
                            <div class="lvl-center">
                                <div class="lvl-num">${lvl}</div>
                                <div class="lvl-lbl">Level</div>
                            </div>
                        </div>
                        <div class="ach-info">
                            <div class="ach-title">${ld.name}</div>
                            <div class="ach-sub">Keep unlocking badges to rise through the tiers - Platinum awaits.</div>
                            <div class="xp-row"><span>${totalXP} XP</span><span class="xp-next">Next: ${ld.next} XP</span></div>
                            <div class="xp-bg"><div class="xp-fill" id="ach-xp-fill" style="width:0%"></div></div>
                        </div>
                        <div class="ach-stats">
                            <div><div class="ach-stat-val" style="color:#80deea">${BADGES.filter(b => b.tier === 'platinum' && earned.has(b.id)).length}</div><div class="ach-stat-lbl">Platinum</div></div>
                            <div><div class="ach-stat-val" style="color:#ffd54f">${BADGES.filter(b => b.tier === 'gold' && earned.has(b.id)).length}</div><div class="ach-stat-lbl">Gold</div></div>
                            <div><div class="ach-stat-val" style="color:#b0bec5">${BADGES.filter(b => b.tier === 'silver' && earned.has(b.id)).length}</div><div class="ach-stat-lbl">Silver</div></div>
                            <div><div class="ach-stat-val" style="color:#e8975a">${BADGES.filter(b => b.tier === 'bronze' && earned.has(b.id)).length}</div><div class="ach-stat-lbl">Bronze</div></div>
                        </div>
                    </div>

                    <div class="ach-sec-hdr"><div class="ach-sec-title">${ti('trophy')} Recently Earned</div></div>
                    <div class="recent-strip">
                        ${BADGES.filter(b => earned.has(b.id)).slice(-10).reverse().map(b => {
            const t = TIER_META[b.tier];
            return `<div class="mini-badge"><div class="mini-ico" style="background:${t.bg};border:1.5px solid ${t.bord};color:${t.color}">${ti(b.icon)}</div><div class="mini-name" style="color:${t.color}">${b.name}</div></div>`;
        }).join('')}
                    </div>

                    ${'platinum,gold,silver,bronze'.split(',').map(tier => {
            const t = TIER_META[tier];
            const bs = BADGES.filter(b => b.tier === tier);
            const te = bs.filter(b => earned.has(b.id)).length;
            const pctT = Math.round((te / bs.length) * 100);
            const isPlat = tier === 'platinum';
            return `<div class="tier-section">
                            <div class="tier-header" style="border-color:${t.bord}">
                                <span class="tier-icon">${ti(t.icon)}</span>
                                <div class="tier-info">
                                    <div class="tier-name" style="color:${t.color}">${t.label}</div>
                                    <div class="tier-sub">${t.sub}</div>
                                </div>
                                <span class="tier-pill" style="color:${t.color};border-color:${t.bord};background:${t.bg}">${te}/${bs.length}</span>
                                <div class="tier-prog-wrap">
                                    <div class="tier-prog-lbl">${pctT}%</div>
                                    <div class="tier-prog-bg"><div class="tier-prog-fill" style="width:${pctT}%;background:${t.color}"></div></div>
                                </div>
                            </div>
                            <div class="badges-grid">
                                ${bs.map(b => {
                const isE = earned.has(b.id);
                return `<div class="badge-card ${isE ? 'earned' : 'locked'} ${isPlat && isE ? 'plat' : ''}" style="${isE ? 'border-color:' + t.bord + ';background:' + t.bg : ''}">
                                        ${isPlat && isE ? '<div class="plat-sparkle"></div>' : ''}
                                        <div class="badge-shell" style="background:${isE ? t.bg : 'var(--t-surface)'}">
                                            <div class="badge-ring" style="border-color:${isE ? t.bord : 'var(--t-border)'}"></div>
                                            <div class="badge-glow" style="background:${t.color}"></div>
                                            <span style="${isE ? '' : 'filter:grayscale(1);opacity:.3'}">${ti(b.icon)}</span>
                                            ${!isE ? `<div class="lock-ov">${ti('lock')}</div>` : ''}
                                        </div>
                                        <div class="badge-nm">${b.name}</div>
                                        <div class="${isE ? 'badge-ds' : 'badge-ht'}">${isE ? b.desc : b.hint}</div>
                                        <div class="xp-tag" style="color:${isE ? t.color : 'var(--t-muted)'};border-color:${isE ? t.bord : 'var(--t-border2)'};background:${isE ? t.bg : 'transparent'}">+${b.xp} XP</div>
                                    </div>`;
            }).join('')}
                            </div>
                        </div>`;
        }).join('')}
                </div>
            </div>
        `;

        // Init stars background
        initStarsBg('ach-stars');

        // Animate XP ring + bar after render
        setTimeout(() => {
            const circ = 2 * Math.PI * 52;
            const ring = document.getElementById('ach-ring-fill');
            if (ring) ring.style.strokeDashoffset = circ * (1 - xpPct / 100);
            const fill = document.getElementById('ach-xp-fill');
            if (fill) fill.style.width = xpPct + '%';
        }, 200);
    }

    const routes = {
        'hero': renderHero,
        'setup': renderSetup,
        'session': renderSession,
        'report': renderReport,
        'history': renderHistory,
        'questions': renderQuestions,
        'achievements': renderAchievements,
        'portfolio': renderPortfolio,
        'games': renderGames
    };

    function navigate(route) {
        // Clean up session resources when leaving the interview page
        if (route !== 'session') {
            // Stop body language analysis
            if (window.BodyLanguageAnalyzer && window.BodyLanguageAnalyzer.isActive()) {
                window.BodyLanguageAnalyzer.stop();
            }
            // Remove presence HUD
            hidePresenceHUD();
            // Stop camera
            stopCamera();
            // Clear session timer
            if (window.sessionInterval) {
                clearInterval(window.sessionInterval);
                window.sessionInterval = null;
            }
            if (state.currentAudio) {
                state.currentAudio.pause();
                state.currentAudio = null;
            }
        }
        if (routes[route]) {
            mainContent.innerHTML = '';
            routes[route]();
        }
    }

    // --- Hero Section (Redesigned v3 - Final Concept) ---
    function renderHero() {
        const heroModules = [
            { id: 'general', icon: 'layers-intersect', title: 'General Interview', desc: 'Standard HR and common interview questions with structured feedback.', color: '99,102,241', tags: ['Behavioral', 'STAR Method', 'Culture Fit'] },
            { id: 'roleplay', icon: 'messages', title: 'Roleplay & Behavioral', desc: 'Practice behavioral questions and situational roleplaying scenarios.', color: '168,85,247', tags: ['Conflict Resolution', 'De-escalation', 'Negotiation'] },
            { id: 'technical', icon: 'code', title: 'Technical Assessment', desc: 'Role-specific technical questions and core engineering skills.', color: '59,130,246', tags: ['System Design', 'Algorithms', 'Code Review'] },
            { id: 'visual', icon: 'presentation', title: 'Visual & Whiteboard', desc: 'Questions requiring visual explanation or whiteboard drawing.', color: '20,184,166', tags: ['UI/UX Design', 'Architecture', 'Wireframing'] },
            { id: 'casestudy', icon: 'chart-dots-3', title: 'Case Study & Strategy', desc: 'Problem-solving, case studies, and strategic thinking challenges.', color: '236,72,153', tags: ['Consulting', 'Market Analysis', 'Frameworks'] },
            { id: 'salary', icon: 'cash', title: 'Salary Negotiation', desc: 'Practice handling compensation discussions and offer negotiations.', color: '34,197,94', tags: ['Counter Offer', 'BATNA', 'Benefits', 'Anchoring'] },
        ];
        const heroNavItems = [
            { view: 'questions', icon: 'book-2', label: 'Questions' },
            { view: 'history', icon: 'history', label: 'History' },
            { view: 'achievements', icon: 'trophy', label: 'Achievements' },
            { view: 'portfolio', icon: 'briefcase', label: 'Portfolio' },
            { view: 'games', icon: 'device-gamepad-2', label: 'Minigames' },
        ];
        mainContent.innerHTML = `
            <style>

                /* -- RESET FOR HERO -- */
                .hero-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);overflow:hidden;font-family:'Plus Jakarta Sans','Inter',sans-serif}
                .hero-wrap::-webkit-scrollbar{display:none}
                html,body{scrollbar-width:none;-ms-overflow-style:none}
                html::-webkit-scrollbar,body::-webkit-scrollbar{display:none}

                /* -- NAVBAR -- */
                .hero-nav{position:fixed;top:0;left:0;right:0;z-index:100;display:flex;align-items:center;justify-content:space-between;padding:0 36px;height:76px;background:transparent;pointer-events:none}
                .nav-brand{display:flex;align-items:center;gap:11px;cursor:pointer;pointer-events:auto;min-width:140px}
                .nav-logo{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,hsl(38,92%,50%),hsl(28,100%,58%));display:flex;align-items:center;justify-content:center;box-shadow:0 2px 16px hsla(38,92%,50%,.35),inset 0 1px 0 rgba(255,255,255,.3);overflow:hidden}
                .nav-logo .ti{font-size:20px;color:#111}
                .nav-title{font-family:'Space Grotesk',sans-serif;font-size:18px;font-weight:800;color:var(--t-heading);letter-spacing:-.03em}
                .nav-center{pointer-events:auto;display:flex;justify-content:center;position:absolute;left:50%;transform:translateX(-50%)}
                .menu-nav{padding:6px;background:transparent;border:1px solid transparent;display:flex;justify-content:center;border-radius:15px;box-shadow:none}
                html:not(.dark) .menu-nav{background:transparent;border-color:transparent;box-shadow:none}
                .menu-link{display:inline-flex;justify-content:center;align-items:center;width:50px;height:44px;border-radius:10px;position:relative;z-index:1;overflow:hidden;transform-origin:center left;transition:width 0.3s cubic-bezier(0.2,0,0,1);text-decoration:none;color:var(--t-nav-link);background:transparent;border:none;cursor:pointer;font-family:inherit;padding:0}
                .menu-link::before{position:absolute;z-index:-1;content:"";display:block;border-radius:10px;width:100%;height:100%;top:0;transform:translateX(100%);transition:transform 0.3s cubic-bezier(0.2,0,0,1);transform-origin:center right;background:var(--t-surface-hover)}
                .menu-link:hover,.menu-link:focus{outline:0;width:140px;color:var(--t-nav-link-hover)}
                .menu-link:hover::before,.menu-link:focus::before,.menu-link:hover .link-title,.menu-link:focus .link-title{transform:translateX(0);opacity:1}
                .link-icon{width:22px;height:22px;display:block;flex-shrink:0;left:14px;position:absolute;transition:color 0.3s}
                .link-icon .ti{font-size:22px}
                .link-title{transform:translateX(100%);transition:transform 0.3s cubic-bezier(0.2,0,0,1),opacity 0.3s;transform-origin:center right;display:block;text-align:left;padding-left:44px;width:100%;font-size:13px;font-weight:600;opacity:0;white-space:nowrap}
                .nav-right{pointer-events:auto;display:flex;align-items:center;min-width:140px;justify-content:flex-end}
                .nav-theme-btn{width:44px;height:44px;border-radius:12px;border:1px solid transparent;background:transparent;display:flex;align-items:center;justify-content:center;cursor:pointer;transition:all .25s;color:var(--t-nav-link);padding:0}
                .nav-theme-btn:hover{background:var(--t-surface-hover);color:var(--t-nav-link-hover);border-color:transparent}
                .nav-theme-btn .ti{font-size:20px}
                html:not(.dark) .nav-theme-btn{background:transparent;border-color:transparent}
                html.dark .sun-icon{display:none}
                html:not(.dark) .moon-icon{display:none}

                /* -- ORBS (slow breathing) -- */
                .hero-orbs{pointer-events:none;position:fixed;inset:0;z-index:0}
                .hero-orbs .orb{position:absolute;border-radius:50%;filter:blur(100px);will-change:transform,opacity}
                .hero-orbs .o1{width:600px;height:600px;background:hsla(38,92%,50%,.09);top:-160px;left:-180px;animation:hd1 18s ease-in-out infinite,breathe1 8s ease-in-out infinite}
                .hero-orbs .o2{width:450px;height:450px;background:hsla(270,80%,65%,.07);bottom:-120px;right:-120px;animation:hd2 22s ease-in-out infinite,breathe2 10s ease-in-out infinite}
                .hero-orbs .o3{width:380px;height:380px;background:hsla(190,92%,60%,.10);top:40%;left:60%;animation:hd3 26s ease-in-out infinite,breathe3 12s ease-in-out infinite}
                @keyframes hd1{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(60px,40px) scale(1.08)}}
                @keyframes hd2{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-50px,-60px) scale(1.05)}}
                @keyframes hd3{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) translate(30px,-40px) scale(1.1)}}
                @keyframes breathe1{0%,100%{opacity:.6}50%{opacity:1}}
                @keyframes breathe2{0%,100%{opacity:.5}50%{opacity:1}}
                @keyframes breathe3{0%,100%{opacity:.5}50%{opacity:1}}

                /* -- GRAVITY STARS CANVAS -- */
                .gravity-stars{pointer-events:none;position:fixed;inset:0;z-index:1;overflow:hidden}
                .gravity-stars canvas{display:block;width:100%;height:100%}

                /* -- HERO CENTER -- */
                .hero-center{position:relative;z-index:10;display:flex;flex-direction:column;align-items:center;text-align:center;padding:110px 24px 50px;max-width:760px;margin:0 auto}
                .hero-center > *{opacity:0;transform:translateY(18px);animation:heroUp .7s ease forwards}
                .hero-center .d0{animation-delay:.1s}
                .hero-center .d1{animation-delay:.22s}
                .hero-center .d2{animation-delay:.36s}
                .hero-center .d3{animation-delay:.5s}
                @keyframes heroUp{to{opacity:1;transform:translateY(0)}}

                .hero-pill{display:inline-flex;align-items:center;gap:7px;padding:7px 16px;border-radius:99px;border:1px solid rgba(250,200,50,.18);background:rgba(250,200,50,.05);font-size:11px;font-weight:700;color:hsl(38,92%,50%);margin-bottom:28px;letter-spacing:.03em}
                .hero-h1{font-family:'Space Grotesk',sans-serif;font-size:clamp(2.2rem,4.5vw,3.2rem);font-weight:900;line-height:1.15;letter-spacing:-.04em;margin-bottom:18px;color:var(--t-heading)}
                .hero-h1 em{font-style:normal;color:hsl(38,92%,55%)}
                .hero-cycle-word{display:inline-block;transition:opacity .35s ease,transform .35s ease}
                .hero-desc{font-size:.95rem;color:var(--t-muted);max-width:480px;line-height:1.75;margin-bottom:32px}
                .hero-actions{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap}
                .hero-start-btn{position:relative;display:inline-flex;align-items:center;gap:10px;padding:14px 40px;border-radius:13px;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:15px;font-weight:700;color:hsl(38,88%,60%);background:hsla(38,80%,50%,.08);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border:1.5px solid hsla(38,92%,50%,.3);box-shadow:inset 0 2px 6px rgba(0,0,0,.3),inset 0 -1px 3px rgba(255,255,255,.02),0 0 20px -6px hsla(38,92%,50%,.15);transition:all .35s cubic-bezier(.4,0,.2,1);letter-spacing:-.01em;overflow:hidden}
                .hero-start-btn::after{content:'';position:absolute;inset:0;background:radial-gradient(ellipse 50% 35% at 50% 100%,hsla(38,92%,50%,.06),transparent 70%);border-radius:13px;pointer-events:none}
                .hero-start-btn:hover{border-color:hsla(38,92%,50%,.5);box-shadow:inset 0 2px 6px rgba(0,0,0,.3),0 0 30px -4px hsla(38,92%,50%,.3);background:hsla(38,80%,50%,.12)}
                .hero-start-btn:active{transform:scale(.98)}
                .hero-start-arrow{font-size:18px;transition:transform .25s}
                .hero-start-btn:hover .hero-start-arrow{transform:translateX(4px)}
                .hero-demo-btn{display:inline-flex;align-items:center;gap:9px;padding:13px 24px;border-radius:13px;cursor:pointer;font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:700;color:var(--t-fg);background:var(--t-surface);border:1px solid var(--t-border);transition:all .25s}
                .hero-demo-btn:hover{border-color:var(--t-border2);background:var(--t-surface-hover);transform:translateY(-1px)}
                .hero-demo-btn .ti{font-size:18px;color:hsl(190,92%,60%)}

                /* -- TRUST BADGES -- */
                .hero-trust{display:flex;align-items:center;gap:20px;margin-top:24px;opacity:0;animation:heroUp .6s ease .62s forwards}
                .trust-item{display:flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--t-muted);letter-spacing:.01em}
                .trust-icon{width:16px;height:16px;border-radius:5px;display:flex;align-items:center;justify-content:center;font-size:9px;background:var(--t-surface);border:1px solid var(--t-bar-track)}
                .trust-dot{width:3px;height:3px;border-radius:50%;background:var(--t-border2)}

                /* -- HERO DIVIDER -- */
                .hero-divider{position:relative;z-index:10;max-width:600px;margin:0 auto 10px;height:1px;background:linear-gradient(90deg,transparent,var(--t-bar-track),hsla(38,92%,50%,.12),var(--t-bar-track),transparent);opacity:0;animation:heroUp .6s ease .7s forwards}

                /* -- MODULE CARDS -- */
                .modules-section{position:relative;z-index:10;max-width:1020px;margin:0 auto;padding:0 36px 60px}
                .modules-header{text-align:center;margin-bottom:36px;opacity:0;animation:heroUp .65s ease .55s forwards}
                .modules-label{font-family:'Space Grotesk',sans-serif;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:hsl(38,92%,50%);margin-bottom:8px}
                .modules-title{font-family:'Space Grotesk',sans-serif;font-size:1.5rem;font-weight:800;color:var(--t-heading);letter-spacing:-.02em}

                .modules-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
                @media(max-width:900px){.modules-grid{grid-template-columns:repeat(2,1fr)}}
                @media(max-width:560px){.modules-grid{grid-template-columns:1fr}}

                .module-card{position:relative;border-radius:16px;padding:22px 20px 20px;cursor:default;transition:all .4s cubic-bezier(.4,0,.2,1);overflow:hidden;opacity:0;animation:heroUp .55s ease forwards;
                    background:var(--t-surface);
                    backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
                    border:1.5px solid var(--t-border);
                    box-shadow:inset 0 3px 12px rgba(0,0,0,.4),inset 0 1px 3px rgba(0,0,0,.2),inset 0 -2px 6px rgba(255,255,255,.015);
                }
                .module-card::before{content:'';position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent 10%,var(--t-surface) 50%,transparent 90%)}
                .module-card::after{content:'';position:absolute;inset:0;border-radius:16px;opacity:0;transition:opacity .4s;background:radial-gradient(ellipse 80% 60% at 50% 100%,var(--t-surface-dim),transparent 60%);pointer-events:none}
                .module-card:hover{border-color:var(--t-border2);box-shadow:inset 0 3px 12px rgba(0,0,0,.4),inset 0 1px 3px rgba(0,0,0,.2),0 0 28px -8px var(--card-c)}
                .module-card:hover::after{opacity:1}

                .card-glow{position:absolute;top:-80px;right:-80px;width:220px;height:220px;border-radius:50%;filter:blur(60px);opacity:.04;transition:opacity .5s;pointer-events:none}
                .module-card:hover .card-glow{opacity:.2}

                .card-icon-wrap{width:48px;height:48px;border-radius:13px;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:14px;position:relative;
                    background:var(--t-surface-dim);border:1px solid var(--t-bar-track);
                    backdrop-filter:blur(8px);transition:all .35s;
                }
                .module-card:hover .card-icon-wrap{border-color:var(--t-border2);box-shadow:0 0 24px -4px var(--card-c)}

                .card-title-text{font-family:'Space Grotesk',sans-serif;font-size:14px;font-weight:700;color:var(--t-heading);margin-bottom:5px;letter-spacing:-.01em}
                .card-desc-text{font-size:12px;color:var(--t-muted);line-height:1.6;margin-bottom:12px}
                .card-tags{display:flex;flex-wrap:wrap;gap:5px}
                .card-tag{padding:3px 9px;border-radius:5px;font-size:10px;font-weight:600;color:var(--tag-c);background:var(--tag-bg);border:1px solid var(--tag-bord);transition:all .3s}
                .module-card:hover .card-tag{filter:brightness(1.3)}

                /* -- LIGHT MODE HERO FIXES (inline) -- */
                html:not(.dark) .module-card{background:rgba(255,255,255,.35)!important;backdrop-filter:blur(20px)!important;-webkit-backdrop-filter:blur(20px)!important;border:1.5px solid rgba(255,255,255,.5)!important;box-shadow:0 1px 0 rgba(255,255,255,.6) inset,0 -1px 0 rgba(0,0,0,.04) inset,0 4px 20px rgba(0,0,0,.06)!important}
                html:not(.dark) .module-card:hover{border-color:rgba(255,255,255,.7)!important;box-shadow:0 1px 0 rgba(255,255,255,.7) inset,0 -1px 0 rgba(0,0,0,.04) inset,0 8px 32px rgba(0,0,0,.1),0 0 28px -8px var(--card-c)!important}
                html:not(.dark) .card-icon-wrap{background:rgba(255,255,255,.45)!important;border-color:rgba(255,255,255,.5)!important}
                html:not(.dark) .hero-start-btn{background:linear-gradient(135deg,hsl(38,92%,50%),hsl(28,95%,52%))!important;border:none!important;color:#fff!important;box-shadow:0 4px 20px hsla(38,92%,50%,.35),0 1px 0 rgba(255,255,255,.25) inset!important;padding:15px 44px!important;border-radius:14px!important;position:relative!important;overflow:hidden!important}
                html:not(.dark) .hero-start-btn::before{content:''!important;position:absolute!important;top:0!important;left:-100%!important;width:60%!important;height:100%!important;background:linear-gradient(90deg,transparent,rgba(255,255,255,.25),transparent)!important;animation:btnShimmer 3s ease-in-out infinite!important}
                @keyframes btnShimmer{0%,100%{left:-100%}50%{left:150%}}
                html:not(.dark) .hero-start-btn:hover{background:linear-gradient(135deg,hsl(38,92%,55%),hsl(28,95%,57%))!important;box-shadow:0 6px 28px hsla(38,92%,50%,.5),0 1px 0 rgba(255,255,255,.3) inset!important;transform:translateY(-2px)!important}
                html:not(.dark) .hero-start-btn:active{transform:translateY(0)!important;box-shadow:0 2px 12px hsla(38,92%,50%,.3)!important}
                html:not(.dark) .hero-start-btn .hero-start-arrow{color:#fff!important}
                html:not(.dark) .hero-demo-btn{background:rgba(255,255,255,.55)!important;border-color:rgba(255,255,255,.7)!important;box-shadow:0 4px 18px rgba(0,0,0,.07)!important;color:#1f2937!important}
            </style>

            <div class="hero-wrap">
                <div class="hero-orbs">
                    <div class="orb o1"></div>
                    <div class="orb o2"></div>
                    <div class="orb o3"></div>
                </div>
                <div class="gravity-stars" id="heroGravityRoot"><canvas id="heroGravityCanvas"></canvas></div>

                <!-- NAVBAR -->
                <nav class="hero-nav">
                    <div class="nav-brand" onclick="window.nav('hero')">
                        <div class="nav-logo">${ti('sparkles')}</div>
                        <span class="nav-title">AI Coach</span>
                    </div>
                    <div class="nav-center">
                        <div class="menu-nav">
                            ${heroNavItems.map(item => `
                                <button class="menu-link" onclick="window.nav('${item.view}')">
                                    <span class="link-icon">${ti(item.icon)}</span>
                                    <span class="link-title">${item.label}</span>
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    <div class="nav-right">
                        <button class="nav-theme-btn" id="hero-theme-toggle" title="Toggle theme" aria-label="Toggle theme">
                            <span class="sun-icon">${ti('sun')}</span>
                            <span class="moon-icon">${ti('moon')}</span>
                        </button>
                    </div>
                </nav>

                <!-- HERO CENTER -->
                <div class="hero-center">
                    <div class="hero-pill d0">${ti('sparkles')} AI-Powered Interview Preparation</div>
                    <h1 class="hero-h1 d1">
                        Master Every Interview,<br>
                        <em><span class="hero-cycle-word" id="heroCycleEl">Any Industry</span></em>
                    </h1>
                    <p class="hero-desc d2">
                        The multimodal AI coach that adapts to your role - from behavioral roleplays
                        to whiteboard challenges and technical assessments.
                    </p>
                    <div class="hero-actions d3">
                        <button class="hero-start-btn" onclick="window.nav('setup')">
                            Start Practicing <span class="hero-start-arrow">${ti('arrow-right')}</span>
                        </button>
                        <button class="hero-demo-btn" onclick="window.loadDemoReport()">
                            ${ti('chart-bar')} Demo Report
                        </button>
                    </div>

                    <div class="hero-trust">
                        <div class="trust-item"><span class="trust-icon">${ti('lock')}</span> Local-first</div>
                        <div class="trust-dot"></div>
                        <div class="trust-item"><span class="trust-icon">${ti('bolt')}</span> No Sign-Up</div>
                        <div class="trust-dot"></div>
                        <div class="trust-item"><span class="trust-icon">${ti('shield-check')}</span> Privacy-First</div>
                    </div>
                </div>

                <div class="hero-divider"></div>

                <!-- MODULE CARDS -->
                <div class="modules-section">
                    <div class="modules-header">
                        <div class="modules-label">Choose Your Training</div>
                        <div class="modules-title">Interview Modules</div>
                    </div>
                    <div class="modules-grid">
                        ${heroModules.map((m, i) => `
                            <div class="module-card" style="animation-delay:${0.6 + i * 0.09}s;--card-c:rgba(${m.color},.4);--tag-c:rgba(${m.color},.7);--tag-bg:rgba(${m.color},.06);--tag-bord:rgba(${m.color},.18)">
                                <div class="card-glow" style="background:rgb(${m.color})"></div>
                                <div class="card-icon-wrap" style="border-color:rgba(${m.color},.15);background:rgba(${m.color},.06)">
                                    ${ti(m.icon)}
                                </div>
                                <div class="card-title-text">${m.title}</div>
                                <div class="card-desc-text">${m.desc}</div>
                                <div class="card-tags">
                                    ${m.tags.map(t => `<span class="card-tag">${t}</span>`).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        // -- Theme toggle in navbar --
        const heroThemeBtn = document.getElementById('hero-theme-toggle');
        if (heroThemeBtn) {
            heroThemeBtn.addEventListener('click', () => {
                const isDark = document.documentElement.classList.toggle('dark');
                localStorage.setItem('theme', isDark ? 'dark' : 'light');
            });
        }

        // -- Cycling Text --
        const words = ['Any Industry', 'Any Company', 'Any Role'];
        let wIdx = 0;
        const cycleEl = document.getElementById('heroCycleEl');
        if (cycleEl) {
            setInterval(() => {
                cycleEl.style.transition = 'opacity .35s ease, transform .35s ease';
                cycleEl.style.opacity = '0';
                cycleEl.style.transform = 'translateY(-12px)';
                setTimeout(() => {
                    wIdx = (wIdx + 1) % words.length;
                    cycleEl.textContent = words[wIdx];
                    cycleEl.style.transition = 'none';
                    cycleEl.style.transform = 'translateY(12px)';
                    requestAnimationFrame(() => {
                        cycleEl.style.transition = 'opacity .35s ease, transform .35s ease';
                        cycleEl.style.opacity = '1';
                        cycleEl.style.transform = 'translateY(0)';
                    });
                }, 380);
            }, 2800);
        }

        // -- Gravity Stars Background --
        const gsCanvas = document.getElementById('heroGravityCanvas');
        const gsRoot = document.getElementById('heroGravityRoot');
        if (gsCanvas && gsRoot) {
            const gsCtx = gsCanvas.getContext('2d');
            const isDarkMode = () => document.documentElement.classList.contains('dark');
            const GS = {
                count: 90, size: 2, opacity: 0.7, glowIntensity: 15,
                glowAnim: 'spring', speed: 0.3, mouseR: 100,
                gravity: 'attract', gravStr: 75, interact: true, interactType: 'bounce',
            };
            let gsDpr = 1, gsW = 800, gsH = 600, gsMouseX = -9999, gsMouseY = -9999;
            let gsParticles = [];

            function gsColor() {
                return [255, 255, 255];
            }

            function gsCreate(w, h) {
                const a = Math.random() * Math.PI * 2;
                const sp = GS.speed * (0.5 + Math.random() * 0.5);
                return {
                    x: Math.random() * w, y: Math.random() * h, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    size: Math.random() * GS.size + 1, opacity: GS.opacity, baseOp: GS.opacity,
                    mass: Math.random() * 0.5 + 0.5, gm: 1, gv: 0
                };
            }
            function gsInit(w, h) { gsParticles = []; for (let i = 0; i < GS.count; i++) gsParticles.push(gsCreate(w, h)); }
            function gsResize() {
                const r = gsRoot.getBoundingClientRect();
                gsDpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
                gsCanvas.width = Math.floor(r.width * gsDpr); gsCanvas.height = Math.floor(r.height * gsDpr);
                gsCanvas.style.width = r.width + 'px'; gsCanvas.style.height = r.height + 'px';
                gsW = r.width; gsH = r.height;
                if (!gsParticles.length) gsInit(gsW, gsH);
                else gsParticles.forEach(p => { p.x = Math.random() * gsW; p.y = Math.random() * gsH; });
            }
            function gsUpdate() {
                for (let i = 0; i < gsParticles.length; i++) {
                    const p = gsParticles[i];
                    const dx = gsMouseX - p.x, dy = gsMouseY - p.y, dist = Math.hypot(dx, dy);
                    if (dist < GS.mouseR && dist > 0) {
                        const force = (GS.mouseR - dist) / GS.mouseR;
                        const nx = dx / dist, ny = dy / dist, g = force * (GS.gravStr * 0.001);
                        if (GS.gravity === 'attract') { p.vx += nx * g; p.vy += ny * g; } else { p.vx -= nx * g; p.vy -= ny * g; }
                        p.opacity = Math.min(1, p.baseOp + force * 0.4);
                        const tg = 1 + force * 2;
                        const sp = (tg - p.gm) * 0.2; p.gv = p.gv * 0.85 + sp; p.gm += p.gv;
                    } else {
                        p.opacity = Math.max(p.baseOp * 0.3, p.opacity - 0.02);
                        const sp = (1 - p.gm) * 0.15; p.gv = p.gv * 0.9 + sp; p.gm = Math.max(1, p.gm + p.gv);
                    }
                    if (GS.interact) {
                        for (let j = i + 1; j < gsParticles.length; j++) {
                            const o = gsParticles[j], dx2 = o.x - p.x, dy2 = o.y - p.y, d = Math.hypot(dx2, dy2), minD = p.size + o.size + 5;
                            if (d < minD && d > 0) {
                                const nn = dx2 / d, nm = dy2 / d, rv = p.vx - o.vx, rm = p.vy - o.vy, s = rv * nn + rm * nm;
                                if (s < 0) continue;
                                const imp = (2 * s) / (p.mass + o.mass);
                                p.vx -= imp * o.mass * nn; p.vy -= imp * o.mass * nm;
                                o.vx += imp * p.mass * nn; o.vy += imp * p.mass * nm;
                                const ov = minD - d; p.x -= nn * ov * 0.5; p.y -= nm * ov * 0.5; o.x += nn * ov * 0.5; o.y += nm * ov * 0.5;
                            }
                        }
                    }
                    p.x += p.vx; p.y += p.vy;
                    p.vx += (Math.random() - 0.5) * 0.001; p.vy += (Math.random() - 0.5) * 0.001;
                    p.vx *= 0.999; p.vy *= 0.999;
                    if (p.x < 0) p.x = gsW; if (p.x > gsW) p.x = 0; if (p.y < 0) p.y = gsH; if (p.y > gsH) p.y = 0;
                }
            }
            function gsDraw() {
                gsCtx.clearRect(0, 0, gsCanvas.width, gsCanvas.height);
                const [r, g, b] = gsColor();
                const cs = `rgb(${r},${g},${b})`;
                for (const p of gsParticles) {
                    gsCtx.save();
                    gsCtx.shadowColor = cs;
                    gsCtx.shadowBlur = GS.glowIntensity * p.gm * 2;
                    gsCtx.globalAlpha = p.opacity;
                    gsCtx.fillStyle = cs;
                    gsCtx.beginPath();
                    gsCtx.arc(p.x * gsDpr, p.y * gsDpr, p.size * gsDpr, 0, Math.PI * 2);
                    gsCtx.fill();
                    gsCtx.restore();
                }
            }
            function gsLoop() { gsUpdate(); gsDraw(); requestAnimationFrame(gsLoop); }
            gsResize(); gsLoop();
            window.addEventListener('resize', gsResize);
            document.addEventListener('mousemove', e => { const r = gsRoot.getBoundingClientRect(); gsMouseX = e.clientX - r.left; gsMouseY = e.clientY - r.top; });
        }
    }

    // --- Setup Panel ---
    // Helper functions for Alpine.js computed properties (global scope)
    window._getModuleTitle = (id) => { const m = modules.find(m => m.id === id); return m ? m.title : '-'; };
    window._getCharLabel = (id) => { const c = characters.find(c => c.id === id); return c ? c.label : '-'; };
    window._getDiffLabel = (d) => d ? d.charAt(0).toUpperCase() + d.slice(1) : '-';
    window._getDurLabel = (d) => ({ quick: 'Quick (5 Qs)', standard: 'Standard (10 Qs)', extended: 'Extended (20 Qs)' }[d] || '-');
    window._getIndustryLabel = (id) => { const ind = INDUSTRIES.find(i => i.id === id); return ind ? ind.label : 'General'; };

    function renderSetup() {
        const SETUP_CHARS = {
            female: [
                { icon: 'scale', id: 'strict', name: 'Victoria', role: 'Strict & Professional', desc: 'Formal, high standards, expects precise answers.' },
                { icon: 'mood-smile', id: 'friendly', name: 'Sophie', role: 'Friendly & Supportive', desc: 'Warm and encouraging. Builds rapport naturally.' },
                { icon: 'flame', id: 'stress', name: 'Elena', role: 'Stress Interviewer', desc: 'Rapid-fire questions, tests composure under pressure.' },
                { icon: 'brain', id: 'calm', name: 'Maya', role: 'Calm & Analytical', desc: 'Thoughtful deep follow-ups. Values reasoning.' },
                { icon: 'tie', id: 'executive', name: 'Diana', role: 'The Executive Panel', desc: 'C-suite lens: vision, strategy, leadership.' },
                { icon: 'users', id: 'peer', name: 'Jess', role: 'The Peer Interviewer', desc: 'Casual and culture-fit focused.' },
            ],
            male: [
                { icon: 'scale', id: 'strict', name: 'Marcus', role: 'Strict & Professional', desc: 'Formal, high standards, expects precise answers.' },
                { icon: 'mood-smile', id: 'friendly', name: 'James', role: 'Friendly & Supportive', desc: 'Warm and encouraging. Builds rapport naturally.' },
                { icon: 'flame', id: 'stress', name: 'Tyler', role: 'Stress Interviewer', desc: 'Rapid-fire questions, tests composure under pressure.' },
                { icon: 'brain', id: 'calm', name: 'Nathan', role: 'Calm & Analytical', desc: 'Thoughtful deep follow-ups. Values reasoning.' },
                { icon: 'tie', id: 'executive', name: 'Richard', role: 'The Executive Panel', desc: 'C-suite lens: vision, strategy, leadership.' },
                { icon: 'users', id: 'peer', name: 'Alex', role: 'The Peer Interviewer', desc: 'Casual and culture-fit focused.' },
            ]
        };

        const SETUP_MODS = [
            { id: 'general', icon: 'layers-intersect', title: 'General Interview', desc: 'Well-rounded mix of behavioral, situational, and motivational questions.', pills: ['Behavioral', 'STAR Method', 'Culture Fit'] },
            { id: 'roleplay', icon: 'messages', title: 'Roleplay & Behavioral', desc: 'Practice with AI personas - angry customers, conflicts, demanding clients.', pills: ['Conflict Resolution', 'Negotiation', 'Leadership'] },
            { id: 'visual', icon: 'presentation', title: 'Visual & Whiteboard', desc: 'Sketch architectures, explain designs, walk through visual problem-solving.', pills: ['System Architecture', 'UI/UX Design', 'Wireframing'] },
            { id: 'technical', icon: 'code', title: 'Technical Assessment', desc: 'Code reviews, algorithms, system design, and logic puzzles under pressure.', pills: ['System Design', 'Algorithms', 'Code Review'] },
            { id: 'casestudy', icon: 'chart-dots-3', title: 'Case Study & Strategy', desc: 'Analyze business scenarios, market entry problems, structure your reasoning.', pills: ['Market Sizing', 'Product Strategy', 'Frameworks'] },
            { id: 'salary', icon: 'cash', title: 'Salary Negotiation', desc: 'Practice negotiating your offer with a realistic hiring manager.', pills: ['Counter Offer', 'BATNA', 'Anchoring'] },
        ];

        const SETUP_IND = [
            { id: 'general', icon: 'world', label: 'General' },
            { id: 'software', icon: 'device-desktop-code', label: 'Software Eng.' },
            { id: 'finance', icon: 'chart-line', label: 'Finance' },
            { id: 'healthcare', icon: 'heart-pulse', label: 'Healthcare' },
            { id: 'creative', icon: 'palette', label: 'Creative' },
            { id: 'sales', icon: 'handshake', label: 'Sales' },
        ];

        let setupStep = 1;
        const LOCAL_MODEL = 'qwen2.5:7b';
        let setupVoice = state.interviewerPersona.gender || 'female';
        let setupCharIdx = SETUP_CHARS[setupVoice].findIndex(c => c.id === state.interviewerPersona.character);
        if (setupCharIdx < 0) setupCharIdx = 1;
        let stressMode = false;
        const setupRuntime = {
            loading: true,
            data: null,
            error: '',
            pulling: false,
            pullStatus: '',
            pullPercent: 0,
        };

        mainContent.innerHTML = `
            <style>
                .su-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);font-family:'Inter',system-ui,sans-serif;color:var(--t-fg);overflow-x:hidden}
                .su-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
                .su-orb{position:absolute;border-radius:50%;filter:blur(90px)}
                .su-o1{width:600px;height:600px;background:hsla(38,92%,50%,.10);top:-160px;left:-160px;animation:sud1 16s ease-in-out infinite}
                .su-o2{width:450px;height:450px;background:hsla(270,80%,65%,.10);bottom:-100px;right:-100px;animation:sud2 20s ease-in-out infinite}
                .su-o3{width:350px;height:350px;background:hsla(190,92%,60%,.16);top:40%;left:55%;animation:sud3 24s ease-in-out infinite}
                @keyframes sud1{0%,100%{transform:translate(0,0)}50%{transform:translate(70px,50px)}}
                @keyframes sud2{0%,100%{transform:translate(0,0)}50%{transform:translate(-60px,-70px)}}
                @keyframes sud3{0%,100%{transform:translate(-50%,-50%)}50%{transform:translate(-50%,-50%) translate(40px,-50px)}}
                .su-layout{position:relative;z-index:1;display:flex;min-height:100vh}
                .su-side{width:300px;border-right:1px solid var(--t-border);background:rgba(10,10,18,0.6);backdrop-filter:blur(16px);padding:32px 24px;display:flex;flex-direction:column;gap:28px;align-self:stretch;overflow-y:auto;flex-shrink:0}
                .su-back{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--t-muted);background:none;border:none;cursor:pointer;transition:color .2s}
                .su-back:hover{color:var(--t-fg)}
                .su-brand{font-size:15px;font-weight:800;letter-spacing:-.02em;color:hsl(38,92%,50%);margin-top:16px}
                .su-steps{display:flex;flex-direction:column;gap:4px}
                .su-si{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border-radius:10px;cursor:pointer;transition:background .2s;border:1px solid transparent}
                .su-si.active{background:var(--t-surface);border-color:rgba(255,255,255,.13)}
                .su-si.done{opacity:.6}
                .su-si.done .su-sn{background:rgba(100,220,120,.15);color:#6ede80;border-color:rgba(100,220,120,.3)}
                .su-sn{width:28px;height:28px;border-radius:50%;border:1px solid rgba(255,255,255,.13);background:var(--t-surface);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--t-muted);flex-shrink:0;transition:all .3s}
                .su-si.active .su-sn{background:hsla(38,92%,50%,.15);border-color:hsla(38,92%,50%,.4);color:hsl(38,92%,50%)}
                .su-sl{font-size:13px;font-weight:600;color:var(--t-fg);line-height:1.3}
                .su-ss{font-size:11px;color:var(--t-muted);margin-top:2px}
                .su-conn{width:1px;height:16px;background:var(--t-border);margin-left:25px}
                .su-summary{margin-top:auto;background:var(--t-surface-dim);border:1px solid var(--t-border);border-radius:14px;padding:16px}
                .su-sum-t{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted);margin-bottom:12px}
                .su-sum-r{display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px}
                .su-sum-k{font-size:11px;color:var(--t-muted);flex-shrink:0}
                .su-sum-v{font-size:11px;font-weight:600;color:var(--t-fg);text-align:right}
                .su-sum-v.empty{color:var(--t-muted);font-weight:400;font-style:italic}
                .su-sum-d{height:1px;background:var(--t-border);margin:10px 0}
                .su-main{flex:1;padding:48px 56px;display:flex;flex-direction:column;align-items:center}
                .su-prog{height:2px;background:var(--t-border);border-radius:99px;margin-bottom:48px;overflow:hidden;width:100%;max-width:900px}
                .su-prog-bar{height:100%;background:hsl(38,92%,50%);border-radius:99px;transition:width .5s ease}
                .su-panel{display:none;flex-direction:column;flex:1;width:100%;max-width:900px}
                .su-panel.active{display:flex}
                .su-hdr{margin-bottom:36px}
                .su-tag{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:hsl(38,92%,50%);margin-bottom:10px}
                .su-hdr h2{font-size:clamp(1.8rem,3vw,2.4rem);font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:8px}
                .su-hdr p{font-size:15px;color:var(--t-muted);line-height:1.6}
                .su-field{margin-bottom:28px}
                .su-field label{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--t-fg);margin-bottom:10px}
                .su-ico{color:hsl(38,92%,50%);font-size:15px}
                .su-opt{font-size:11px;font-weight:400;color:var(--t-muted);background:var(--t-surface-hover);border:1px solid var(--t-border);padding:1px 7px;border-radius:4px}
                .su-inp,.su-ta{width:100%;background:var(--t-surface);border:1px solid rgba(255,255,255,.13);border-radius:10px;padding:12px 16px;font-size:14px;color:var(--t-fg);font-family:inherit;transition:border-color .2s,box-shadow .2s;outline:none;resize:none}
                .su-inp:focus,.su-ta:focus{border-color:hsla(38,92%,50%,.5);box-shadow:0 0 0 3px hsla(38,92%,50%,.08)}
                .su-inp::placeholder,.su-ta::placeholder{color:var(--t-muted)}
                .su-res-tabs{display:flex;gap:4px;margin-bottom:10px}
                .su-res-tab{padding:7px 14px;border-radius:8px;font-size:12px;font-weight:600;border:1px solid var(--t-border);background:transparent;color:var(--t-muted);cursor:pointer;transition:all .2s;font-family:inherit}
                .su-res-tab.on{background:hsla(38,92%,50%,.1);border-color:hsla(38,92%,50%,.35);color:hsl(38,92%,50%)}
                .su-dz{border:1.5px dashed rgba(255,255,255,.13);border-radius:12px;padding:32px;text-align:center;cursor:pointer;transition:border-color .2s,background .2s;display:flex;flex-direction:column;align-items:center;gap:8px}
                .su-dz:hover{border-color:hsla(38,92%,50%,.4);background:hsla(38,92%,50%,.03)}
                .su-dz-ico{font-size:28px;margin-bottom:4px}
                .su-dz-txt{font-size:13px;color:var(--t-muted)}
                .su-dz-txt span{color:hsl(38,92%,50%);text-decoration:underline}
                .su-dz-sub{font-size:11px;color:var(--t-muted);opacity:.6}
                .su-mods{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
                .su-mod{background:var(--t-surface-dim);border:1.5px solid var(--t-border);border-radius:14px;padding:18px;cursor:pointer;transition:all .25s;text-align:left}
                .su-mod:hover{border-color:rgba(255,255,255,.13);background:var(--t-surface-hover);transform:translateY(-2px)}
                .su-mod.sel{border-color:hsl(38,92%,50%);background:hsla(38,92%,50%,.06);box-shadow:0 0 0 1px hsl(38,92%,50%),0 8px 30px -8px hsla(38,92%,50%,.2)}
                .su-mod-ico{font-size:24px;margin-bottom:10px}
                .su-mod-t{font-size:14px;font-weight:700;color:var(--t-fg);margin-bottom:5px}
                .su-mod-d{font-size:11px;color:var(--t-muted);line-height:1.5;margin-bottom:10px}
                .su-mod-ps{display:flex;flex-wrap:wrap;gap:4px}
                .su-mod-p{font-size:10px;font-weight:600;padding:2px 7px;border-radius:5px;background:var(--t-bar-track);color:var(--t-muted);border:1px solid var(--t-border)}
                .su-stress{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-radius:14px;border:1.5px solid rgba(240,60,60,.25);background:rgba(240,60,60,.05);margin-bottom:28px;transition:all .4s}
                .su-stress.on{border-color:rgba(240,60,60,.6);background:rgba(240,60,60,.1);box-shadow:0 0 30px -8px rgba(240,60,60,.3)}
                .su-stress-lbl{font-size:15px;font-weight:700;color:var(--t-fg)}
                .su-stress-sub{font-size:12px;color:var(--t-muted);margin-top:3px}
                .su-stress.on .su-stress-sub{color:rgba(255,130,130,.8)}
                .su-sec-lbl{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t-muted);margin-bottom:10px;display:flex;align-items:center;gap:7px}
                .su-chars{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:28px}
                .su-char{padding:14px;border-radius:12px;border:1.5px solid var(--t-border);background:var(--t-surface-dim);cursor:pointer;transition:all .25s;text-align:center}
                .su-char:hover{border-color:rgba(255,255,255,.13);transform:translateY(-2px)}
                .su-char.sel{border-color:hsl(38,92%,50%);background:hsla(38,92%,50%,.06);box-shadow:0 0 0 1px hsl(38,92%,50%)}
                .su-char.locked{opacity:.35;pointer-events:none}
                .su-char-e{font-size:24px;margin-bottom:8px}
                .su-char-n{font-size:13px;font-weight:700;color:var(--t-fg);margin-bottom:3px}
                .su-char-r{font-size:10px;color:hsl(38,92%,50%);font-weight:700;margin-bottom:5px}
                .su-char-d{font-size:10px;color:var(--t-muted);line-height:1.5}
                .su-sets{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px}
                .su-tgl-g{display:flex;gap:6px}
                .su-tgl{flex:1;padding:10px 8px;border-radius:10px;border:1.5px solid var(--t-border);background:var(--t-surface-dim);font-size:13px;font-weight:600;color:var(--t-muted);cursor:pointer;transition:all .2s;text-align:center;font-family:inherit}
                .su-tgl:hover{border-color:rgba(255,255,255,.13);color:var(--t-fg)}
                .su-tgl.on-easy{border-color:rgba(100,220,120,.5);background:rgba(100,220,120,.08);color:#6ede80}
                .su-tgl.on-med{border-color:rgba(240,180,60,.5);background:rgba(240,180,60,.08);color:#f0b43c}
                .su-tgl.on-hard{border-color:rgba(240,80,80,.5);background:rgba(240,80,80,.08);color:#f05050}
                .su-tgl.on-amb{border-color:hsla(38,92%,50%,.5);background:hsla(38,92%,50%,.08);color:hsl(38,92%,50%)}
                .su-tgl.locked{opacity:.35;pointer-events:none}
                .su-vtgl{display:flex;gap:6px}
                .su-vt{padding:8px 18px;border-radius:99px;border:1.5px solid var(--t-border);background:transparent;color:var(--t-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
                .su-vt.on{border-color:hsla(38,92%,50%,.5);background:hsla(38,92%,50%,.1);color:hsl(38,92%,50%)}
                .su-ind-chips{display:flex;flex-wrap:wrap;gap:8px}
                .su-ind{padding:7px 13px;border-radius:9px;border:1.5px solid var(--t-border);background:var(--t-surface-dim);font-size:12px;font-weight:600;color:var(--t-muted);cursor:pointer;transition:all .2s;display:flex;align-items:center;gap:5px;font-family:inherit}
                .su-ind:hover{border-color:rgba(255,255,255,.13);color:var(--t-fg)}
                .su-ind.on{border-color:hsla(38,92%,50%,.5);background:hsla(38,92%,50%,.08);color:hsl(38,92%,50%)}
                .su-tr{display:flex;align-items:center;justify-content:space-between;padding:14px 18px;border-radius:12px;border:1px solid var(--t-border);background:var(--t-surface-dim);margin-bottom:10px}
                .su-tr-lbl{font-size:14px;font-weight:600;color:var(--t-fg)}
                .su-tr-sub{font-size:11px;color:var(--t-muted);margin-top:2px}
                .su-sw{width:44px;height:24px;border-radius:99px;background:var(--t-border2);border:1.5px solid var(--t-border);cursor:pointer;position:relative;transition:background .2s;flex-shrink:0}
                .su-sw.on{background:hsl(38,92%,50%);border-color:hsl(38,92%,50%)}
                .su-sw.locked-on{background:rgba(240,80,80,.8);border-color:rgba(240,80,80,.8);pointer-events:none}
                .su-sw-th{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .2s;box-shadow:0 1px 4px rgba(0,0,0,.3)}
                .su-sw.on .su-sw-th,.su-sw.locked-on .su-sw-th{transform:translateX(20px)}
                .su-nav{display:flex;justify-content:space-between;align-items:center;margin-top:auto;padding-top:40px}
                .su-btn-back{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:10px;border:1.5px solid var(--t-border);background:transparent;color:var(--t-muted);font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
                .su-btn-back:hover{border-color:rgba(255,255,255,.13);color:var(--t-fg)}
                .su-btn-next{display:inline-flex;align-items:center;gap:8px;padding:14px 32px;border-radius:10px;background:hsl(38,92%,50%);color:#000;font-size:14px;font-weight:700;border:none;cursor:pointer;box-shadow:0 4px 24px -4px hsla(38,92%,50%,.4);transition:all .25s;font-family:inherit}
                .su-btn-next:hover{transform:translateY(-2px);box-shadow:0 8px 32px -4px hsla(38,92%,50%,.5)}
                .su-btn-next:disabled{opacity:.4;cursor:not-allowed;transform:none}
                .su-btn-launch{background:hsl(38,92%,50%);color:#000;padding:16px 40px;border-radius:12px;font-size:15px;font-weight:800;border:none;cursor:pointer;box-shadow:0 4px 32px -4px hsla(38,92%,50%,.5);transition:all .25s;display:inline-flex;align-items:center;gap:10px;font-family:inherit}
                .su-btn-launch:hover{transform:translateY(-2px);box-shadow:0 10px 40px -4px hsla(38,92%,50%,.6)}
                .su-btn-launch:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}
                .su-btn-launch:disabled:hover{transform:none;box-shadow:none}
                .su-runtime{border:1.5px solid var(--t-border);background:var(--t-surface-dim);border-radius:14px;padding:16px 18px;margin:18px 0 22px;transition:border-color .2s,background .2s}
                .su-runtime.ready{border-color:rgba(74,222,128,.45);background:rgba(74,222,128,.06)}
                .su-runtime.warn{border-color:rgba(251,191,36,.45);background:rgba(251,191,36,.06)}
                .su-runtime.bad{border-color:rgba(248,113,113,.45);background:rgba(248,113,113,.06)}
                .su-runtime-hdr{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;margin-bottom:12px}
                .su-runtime-title{font-size:14px;font-weight:800;color:var(--t-fg)}
                .su-runtime-sub{font-size:12px;color:var(--t-muted);margin-top:3px;line-height:1.5}
                .su-runtime-pill{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;padding:4px 10px;border-radius:999px;border:1px solid var(--t-border2);color:var(--t-muted);white-space:nowrap}
                .su-runtime.ready .su-runtime-pill{border-color:rgba(74,222,128,.45);color:#4ade80}
                .su-runtime.warn .su-runtime-pill{border-color:rgba(251,191,36,.45);color:#fbbf24}
                .su-runtime.bad .su-runtime-pill{border-color:rgba(248,113,113,.45);color:#f87171}
                .su-runtime-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
                .su-runtime-grid div{border:1px solid var(--t-border);border-radius:10px;padding:10px;background:var(--t-surface-dim)}
                .su-runtime-grid span{display:block;font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:var(--t-muted);font-weight:700;margin-bottom:4px}
                .su-runtime-grid strong{font-size:12px;color:var(--t-fg)}
                .su-runtime-actions{display:flex;gap:8px;flex-wrap:wrap}
                .su-runtime-btn{padding:8px 14px;border-radius:9px;border:1px solid var(--t-border2);background:transparent;color:var(--t-fg);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit}
                .su-runtime-btn.primary{background:hsl(38,92%,50%);border-color:hsl(38,92%,50%);color:#000}
                .su-runtime-btn:disabled{opacity:.45;cursor:not-allowed}
                .su-runtime-progress{height:6px;background:var(--t-border);border-radius:999px;overflow:hidden;margin-bottom:12px}
                .su-runtime-progress div{height:100%;width:0%;background:hsl(38,92%,50%);transition:width .25s}
                .su-stress-alert{display:none;align-items:center;gap:8px;padding:10px 16px;border-radius:10px;background:rgba(240,60,60,.1);border:1px solid rgba(240,60,60,.3);margin-bottom:20px;font-size:12px;color:rgba(255,150,150,.9);font-weight:600}
                .su-stress-alert.show{display:flex}
                @media(max-width:900px){.su-side{display:none}.su-main{padding:32px 24px}.su-mods,.su-chars{grid-template-columns:repeat(2,1fr)}.su-sets,.su-runtime-grid{grid-template-columns:1fr}}
            </style>

            <div class="su-wrap">
                <div class="su-orbs"><div class="su-orb su-o1"></div><div class="su-orb su-o2"></div><div class="su-orb su-o3"></div></div>
                ${starsHTML('su-stars')}
                <div class="su-layout">
                    <aside class="su-side">
                        <div>
                            <button class="su-back" onclick="window.nav('hero')">${ti('arrow-left')} Home</button>
                            <div class="su-brand">Interview Chameleon</div>
                        </div>
                        <div class="su-steps">
                            <div class="su-si active" id="su-si-1" onclick="window._suGoStep(1)"><div class="su-sn" id="su-sn-1">1</div><div><div class="su-sl">The Role</div><div class="su-ss">Job title & context</div></div></div>
                            <div class="su-conn"></div>
                            <div class="su-si" id="su-si-2" onclick="window._suGoStep(2)"><div class="su-sn" id="su-sn-2">2</div><div><div class="su-sl">Interview Type</div><div class="su-ss">Choose your module</div></div></div>
                            <div class="su-conn"></div>
                            <div class="su-si" id="su-si-3" onclick="window._suGoStep(3)"><div class="su-sn" id="su-sn-3">3</div><div><div class="su-sl">Customize</div><div class="su-ss">Interviewer & settings</div></div></div>
                        </div>
                        <div class="su-summary">
                            <div class="su-sum-t">Session Preview</div>
                            <div class="su-sum-r"><span class="su-sum-k">Role</span><span class="su-sum-v ${state.targetRole ? '' : 'empty'}" id="su-sum-role">${state.targetRole || 'Not set'}</span></div>
                            <div class="su-sum-r"><span class="su-sum-k">Module</span><span class="su-sum-v empty" id="su-sum-mod">Not set</span></div>
                            <div class="su-sum-d"></div>
                            <div class="su-sum-r"><span class="su-sum-k">Interviewer</span><span class="su-sum-v empty" id="su-sum-char">Not set</span></div>
                            <div class="su-sum-r"><span class="su-sum-k">Difficulty</span><span class="su-sum-v" id="su-sum-diff">${state.difficulty.charAt(0).toUpperCase() + state.difficulty.slice(1)}</span></div>
                            <div class="su-sum-r"><span class="su-sum-k">Duration</span><span class="su-sum-v" id="su-sum-dur">${state.duration === 'quick' ? 'Quick (5 Qs)' : state.duration === 'extended' ? 'Extended (20 Qs)' : 'Standard (10 Qs)'}</span></div>
                            <div class="su-sum-r"><span class="su-sum-k">Industry</span><span class="su-sum-v" id="su-sum-ind">General</span></div>
                        </div>
                    </aside>
                    <main class="su-main">
                        <div class="su-prog"><div class="su-prog-bar" id="su-prog" style="width:33%"></div></div>

                        <!-- STEP 1 -->
                        <div class="su-panel active" id="su-p1">
                            <div class="su-hdr"><div class="su-tag">Step 1 of 3 - The Role</div><h2>What are you interviewing for?</h2><p>Give us the context - the more detail, the sharper your AI coach will be.</p></div>
                            <div class="su-field"><label><span class="su-ico">${ti('briefcase')}</span> Target Job Title</label><input class="su-inp" id="su-role" type="text" placeholder="e.g. Senior Product Designer" value="${state.targetRole || ''}" oninput="window._suUpdateRole()"></div>
                            <div class="su-field"><label><span class="su-ico">${ti('file-text')}</span> Job Description <span class="su-opt">optional</span></label><textarea class="su-ta" id="su-jd" rows="5" placeholder="Paste the job requirements here...">${state.jobDescription || ''}</textarea></div>
                            <div class="su-field">
                                <label><span class="su-ico">${ti('paperclip')}</span> Resume <span class="su-opt">optional</span></label>
                                <div class="su-res-tabs">
                                    <button class="su-res-tab on" onclick="window._suResTab('upload',this)">${ti('upload')} Upload File</button>
                                    <button class="su-res-tab" onclick="window._suResTab('paste',this)">${ti('clipboard-text')} Paste Text</button>
                                </div>
                                <div id="su-tab-upload">
                                    <div class="su-dz" id="su-dropzone"><div class="su-dz-ico">${ti('cloud-upload')}</div><div class="su-dz-txt">Drop your resume here or <span>browse</span></div><div class="su-dz-sub">PDF, DOCX, or TXT</div><input type="file" id="su-file-input" accept=".pdf,.docx,.txt" style="display:none"></div>
                                </div>
                                <div id="su-tab-paste" style="display:none"><textarea class="su-ta" id="su-resume-text" rows="5" placeholder="Paste your resume summary here...">${state.resumeText || ''}</textarea></div>
                            </div>
                            <div class="su-nav"><span></span><button class="su-btn-next" id="su-next1" onclick="window._suGoStep(2)" ${state.targetRole ? '' : 'disabled'}>Choose Module ${ti('arrow-right')}</button></div>
                        </div>

                        <!-- STEP 2 -->
                        <div class="su-panel" id="su-p2">
                            <div class="su-hdr"><div class="su-tag">Step 2 of 3 - Interview Type</div><h2>What kind of interview?</h2><p>Pick the format that matches your target role.</p></div>
                            <div class="su-mods" id="su-mods-grid"></div>
                            <div class="su-nav"><button class="su-btn-back" onclick="window._suGoStep(1)">${ti('arrow-left')} Back</button><button class="su-btn-next" id="su-next2" onclick="window._suGoStep(3)" disabled>Set Up Interviewer ${ti('arrow-right')}</button></div>
                        </div>

                        <!-- STEP 3 -->
                        <div class="su-panel" id="su-p3">
                            <div class="su-hdr"><div class="su-tag">Step 3 of 3 - Customize</div><h2>Who's interviewing you?</h2><p>Pick your interviewer style and dial in the session settings.</p></div>
                            <div class="su-stress" id="su-stress-banner">
                                <div><div class="su-stress-lbl">${ti('flame')} Stress Mode</div><div class="su-stress-sub" id="su-stress-sub">Maximum pressure. Hard - Extended - Interruptions forced on.</div></div>
                                <div class="su-sw" id="su-stress-sw" onclick="window._suToggleStress()"><div class="su-sw-th"></div></div>
                            </div>
                            <div class="su-stress-alert" id="su-stress-alert">${ti('alert-triangle')} Stress Mode active - character, difficulty and duration are locked</div>
                            <div class="su-field" style="margin-bottom:20px"><div class="su-sec-lbl">${ti('volume')} Voice Gender</div><div class="su-vtgl"><button class="su-vt on" onclick="window._suVoice(this,'female')">${ti('gender-female')} Female</button><button class="su-vt" onclick="window._suVoice(this,'male')">${ti('gender-male')} Male</button></div></div>
                            <div class="su-sec-lbl">${ti('microphone')} Interviewer Character</div>
                            <div class="su-chars" id="su-chars-grid"></div>
                            <div class="su-sets" style="margin-top:24px">
                                <div><div class="su-sec-lbl">${ti('target-arrow')} Difficulty</div><div class="su-tgl-g" id="su-diff-grp">
                                    <button class="su-tgl ${state.difficulty === 'easy' ? 'on-easy' : ''}" onclick="window._suDiff(this,'easy','on-easy')">Easy</button>
                                    <button class="su-tgl ${state.difficulty === 'medium' ? 'on-med' : ''}" onclick="window._suDiff(this,'medium','on-med')">Medium</button>
                                    <button class="su-tgl ${state.difficulty === 'hard' ? 'on-hard' : ''}" onclick="window._suDiff(this,'hard','on-hard')">Hard</button>
                                </div></div>
                                <div><div class="su-sec-lbl">${ti('clock')} Duration</div><div class="su-tgl-g" id="su-dur-grp">
                                    <button class="su-tgl ${state.duration === 'quick' ? 'on-amb' : ''}" onclick="window._suDur(this,'quick','Quick (5 Qs)')">Quick</button>
                                    <button class="su-tgl ${state.duration === 'standard' ? 'on-amb' : ''}" onclick="window._suDur(this,'standard','Standard (10 Qs)')">Standard</button>
                                    <button class="su-tgl ${state.duration === 'extended' ? 'on-amb' : ''}" onclick="window._suDur(this,'extended','Extended (20 Qs)')">Extended</button>
                                </div></div>
                            </div>
                            <div class="su-field" style="margin-top:24px;margin-bottom:24px"><div class="su-sec-lbl">${ti('building')} Industry Style</div><div class="su-ind-chips" id="su-ind-chips"></div></div>
                            <div class="su-runtime" id="su-runtime-card">
                                <div class="su-runtime-hdr">
                                    <div>
                                        <div class="su-runtime-title">Local AI Runtime</div>
                                        <div class="su-runtime-sub" id="su-runtime-message">Checking Ollama and qwen2.5:7b...</div>
                                    </div>
                                    <span class="su-runtime-pill" id="su-runtime-pill">Checking</span>
                                </div>
                                <div class="su-runtime-grid">
                                    <div><span>Ollama</span><strong id="su-rt-ollama">Checking</strong></div>
                                    <div><span>Model</span><strong id="su-rt-model">qwen2.5:7b</strong></div>
                                    <div><span>Ready</span><strong id="su-rt-ready">Checking</strong></div>
                                </div>
                                <div class="su-runtime-progress" id="su-runtime-progress" style="display:none"><div id="su-runtime-progress-bar"></div></div>
                                <div class="su-runtime-actions">
                                    <button class="su-runtime-btn" id="su-refresh-runtime-btn" onclick="window._suRefreshRuntime()">${ti('refresh')} Refresh status</button>
                                    <button class="su-runtime-btn primary" id="su-pull-qwen-btn" onclick="window._suPullRuntime()" style="display:none">${ti('download')} Pull qwen2.5:7b</button>
                                </div>
                            </div>
                            <div class="su-sec-lbl">${ti('settings')} Advanced</div>
                            <div class="su-tr"><div><div class="su-tr-lbl">${ti('building-skyscraper')} FAANG / Big Tech Mode</div><div class="su-tr-sub">Bar-raiser standards & Leadership Principles</div></div><div class="su-sw ${state.faangMode ? 'on' : ''}" id="su-faang-sw" onclick="window._suToggleSw(this)"><div class="su-sw-th"></div></div></div>
                            <div class="su-tr"><div><div class="su-tr-lbl">${ti('bolt')} Random Interruptions</div><div class="su-tr-sub">AI interrupts mid-response to test composure</div></div><div class="su-sw ${state.interruptionsEnabled ? 'on' : ''}" id="su-int-sw" onclick="window._suToggleSw(this)"><div class="su-sw-th"></div></div></div>
                            <div class="su-nav"><button class="su-btn-back" onclick="window._suGoStep(2)">${ti('arrow-left')} Back</button><button class="su-btn-launch" id="su-launch-btn" onclick="window._suLaunch()" disabled>${ti('rocket')} Launch Interview Session</button></div>
                        </div>
                    </main>
                </div>
            </div>
        `;

        // Init stars background
        initStarsBg('su-stars');

        // Render module cards
        const modsGrid = document.getElementById('su-mods-grid');
        if (modsGrid) {
            modsGrid.innerHTML = SETUP_MODS.map(m => `
                <div class="su-mod ${state.selectedModule === m.id ? 'sel' : ''}" onclick="window._suSelectMod('${m.id}',this)">
                    <div class="su-mod-ico">${ti(m.icon)}</div>
                    <div class="su-mod-t">${m.title}</div>
                    <div class="su-mod-d">${m.desc}</div>
                    <div class="su-mod-ps">${m.pills.map(p => `<span class="su-mod-p">${p}</span>`).join('')}</div>
                </div>
            `).join('');
        }

        // Render industry chips
        const indChips = document.getElementById('su-ind-chips');
        if (indChips) {
            indChips.innerHTML = SETUP_IND.map(ind => `
                <button class="su-ind ${state.industry === ind.id ? 'on' : ''}" onclick="window._suInd(this,'${ind.id}','${ind.label}')">${ti(ind.icon)} ${ind.label}</button>
            `).join('');
        }

        // Render characters
        function renderSetupChars() {
            const list = SETUP_CHARS[setupVoice];
            const grid = document.getElementById('su-chars-grid');
            if (!grid) return;
            grid.innerHTML = list.map((c, i) => `
                <div class="su-char ${i === setupCharIdx ? 'sel' : ''} ${stressMode && i !== 2 ? 'locked' : ''}" onclick="window._suChar(${i})">
                    <div class="su-char-e">${ti(c.icon)}</div>
                    <div class="su-char-n">${c.name}</div>
                    <div class="su-char-r">${c.role}</div>
                    <div class="su-char-d">${c.desc}</div>
                </div>
            `).join('');
            const sel = list[setupCharIdx];
            const sumChar = document.getElementById('su-sum-char');
            if (sumChar) { sumChar.textContent = sel.name + ' \u00b7 ' + sel.role; sumChar.classList.remove('empty'); }
            state.interviewerPersona = { character: sel.id, gender: setupVoice };
        }
        renderSetupChars();

        function setSetupText(id, value) {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        }

        function parsePullEvent(rawEvent) {
            const dataLine = rawEvent.split('\n').find(line => line.startsWith('data:'));
            if (!dataLine) return;
            try {
                const payload = JSON.parse(dataLine.slice(5).trim());
                if (payload.status) setupRuntime.pullStatus = payload.status;
                if (typeof payload.percent === 'number') setupRuntime.pullPercent = Math.max(0, Math.min(100, payload.percent));
                renderSetupRuntime();
            } catch (err) {
                setupRuntime.pullStatus = `Pulling ${LOCAL_MODEL}...`;
            }
        }

        function renderSetupRuntime() {
            const data = setupRuntime.data || {};
            const connected = Boolean(data.ollama_connected);
            const hasQwen = Boolean(data.has_recommended);
            const ready = Boolean(data.ready);
            const message = setupRuntime.pulling
                ? (setupRuntime.pullStatus || `Pulling ${LOCAL_MODEL}...`)
                : setupRuntime.loading
                    ? `Checking Ollama and ${LOCAL_MODEL}...`
                    : setupRuntime.error || data.status_message || `Start Ollama locally and install ${LOCAL_MODEL}.`;
            const pill = setupRuntime.loading
                ? 'Checking'
                : ready
                    ? 'Ready'
                    : connected
                        ? 'Model missing'
                        : 'Ollama stopped';
            const variant = setupRuntime.loading ? '' : ready ? 'ready' : connected ? 'warn' : 'bad';

            const card = document.getElementById('su-runtime-card');
            if (card) {
                card.classList.remove('ready', 'warn', 'bad');
                if (variant) card.classList.add(variant);
            }
            setSetupText('su-runtime-message', message);
            setSetupText('su-runtime-pill', pill);
            setSetupText('su-rt-ollama', setupRuntime.loading ? 'Checking' : connected ? 'Yes' : 'No');
            setSetupText('su-rt-model', setupRuntime.loading ? LOCAL_MODEL : hasQwen ? `${LOCAL_MODEL} installed` : `${LOCAL_MODEL} missing`);
            setSetupText('su-rt-ready', setupRuntime.loading ? 'Checking' : ready ? 'Yes' : 'No');

            const progress = document.getElementById('su-runtime-progress');
            const progressBar = document.getElementById('su-runtime-progress-bar');
            if (progress) progress.style.display = setupRuntime.pulling || setupRuntime.pullPercent > 0 ? 'block' : 'none';
            if (progressBar) progressBar.style.width = `${setupRuntime.pullPercent || 0}%`;

            const refreshBtn = document.getElementById('su-refresh-runtime-btn');
            if (refreshBtn) refreshBtn.disabled = setupRuntime.loading || setupRuntime.pulling;

            const pullBtn = document.getElementById('su-pull-qwen-btn');
            if (pullBtn) {
                pullBtn.style.display = connected && !hasQwen && !ready ? 'inline-flex' : 'none';
                pullBtn.disabled = setupRuntime.loading || setupRuntime.pulling;
                pullBtn.innerHTML = setupRuntime.pulling ? `${ti('download')} Pulling ${LOCAL_MODEL}...` : `${ti('download')} Pull ${LOCAL_MODEL}`;
            }

            const launchBtn = document.getElementById('su-launch-btn');
            if (launchBtn) {
                launchBtn.disabled = setupRuntime.loading || setupRuntime.pulling || !ready;
                launchBtn.title = ready ? '' : `Start Ollama and install ${LOCAL_MODEL} before launching.`;
            }
        }

        window._suRefreshRuntime = async () => {
            setupRuntime.loading = true;
            setupRuntime.error = '';
            renderSetupRuntime();
            try {
                const [statusRes, modelsRes] = await Promise.all([
                    fetch('/api/setup/status'),
                    fetch('/api/models'),
                ]);
                if (!statusRes.ok) throw new Error(`Status check failed (${statusRes.status})`);
                const statusData = await statusRes.json();
                let modelData = {};
                if (modelsRes.ok) {
                    try {
                        modelData = await modelsRes.json();
                    } catch (err) {
                        modelData = {};
                    }
                }
                setupRuntime.data = {
                    ...statusData,
                    recommended_model: LOCAL_MODEL,
                    models_status: modelData,
                };
                state.selectedModel = LOCAL_MODEL;
                setupRuntime.pullStatus = '';
                setupRuntime.pullPercent = setupRuntime.data.ready ? 0 : setupRuntime.pullPercent;
            } catch (err) {
                setupRuntime.data = {
                    ollama_connected: false,
                    has_recommended: false,
                    ready: false,
                    recommended_model: LOCAL_MODEL,
                    status_message: 'Ollama is not reachable. Start Ollama locally, then refresh status.',
                };
                setupRuntime.error = 'Unable to check Ollama status. Start Ollama locally, then refresh status.';
            } finally {
                setupRuntime.loading = false;
                renderSetupRuntime();
            }
        };

        window._suPullRuntime = async () => {
            if (setupRuntime.pulling) return;
            if (!setupRuntime.data?.ollama_connected) {
                setupRuntime.error = 'Ollama is not reachable. Start Ollama locally, then refresh status.';
                renderSetupRuntime();
                return;
            }
            setupRuntime.pulling = true;
            setupRuntime.error = '';
            setupRuntime.pullStatus = `Pulling ${LOCAL_MODEL}...`;
            setupRuntime.pullPercent = 0;
            renderSetupRuntime();
            try {
                const res = await fetch('/api/setup/pull', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: LOCAL_MODEL }),
                });
                if (!res.ok) throw new Error(`Pull failed (${res.status})`);
                if (!res.body) throw new Error('Pull response was not streamable.');

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const events = buffer.split('\n\n');
                    buffer = events.pop() || '';
                    events.forEach(parsePullEvent);
                }
                if (buffer.trim()) parsePullEvent(buffer);
                setupRuntime.pullPercent = 100;
                setupRuntime.pullStatus = `${LOCAL_MODEL} pull complete. Refreshing status...`;
                renderSetupRuntime();
                await window._suRefreshRuntime();
            } catch (err) {
                setupRuntime.error = `Could not pull ${LOCAL_MODEL}. Start Ollama and try again.`;
            } finally {
                setupRuntime.pulling = false;
                renderSetupRuntime();
            }
        };

        renderSetupRuntime();
        window._suRefreshRuntime();

        // Wire up file upload
        const dz = document.getElementById('su-dropzone');
        const fi = document.getElementById('su-file-input');
        if (dz && fi) {
            dz.onclick = () => fi.click();
            fi.onchange = async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                dz.innerHTML = `<div class="su-dz-ico">${ti('file-text')}</div><div class="su-dz-txt">${escapeHTML(file.name)}</div><div class="su-dz-sub">Uploading...</div>`;
                const formData = new FormData();
                formData.append('file', file);
                try {
                    const res = await fetch('/api/parse-resume', { method: 'POST', body: formData });
                    const data = await res.json();
                    state.resumeText = data.text || '';
                    dz.innerHTML = `<div class="su-dz-ico">${ti('circle-check')}</div><div class="su-dz-txt">${escapeHTML(file.name)}</div><div class="su-dz-sub">Resume uploaded</div>`;
                } catch (err) {
                    dz.innerHTML = `<div class="su-dz-ico">${ti('circle-x')}</div><div class="su-dz-txt">Upload failed</div><div class="su-dz-sub">Try pasting instead</div>`;
                }
            };
        }

        // Global functions
        window._suGoStep = (n) => {
            const role = (document.getElementById('su-role')?.value || '').trim();
            if (n === 2 && !role) return;
            if (n === 3 && !state.selectedModule) return;
            setupStep = n;
            [1, 2, 3].forEach(i => {
                const p = document.getElementById('su-p' + i);
                const si = document.getElementById('su-si-' + i);
                if (p) p.classList.toggle('active', i === n);
                if (si) { si.classList.remove('active', 'done'); if (i === n) si.classList.add('active'); if (i < n) si.classList.add('done'); }
            });
            const prog = document.getElementById('su-prog');
            if (prog) prog.style.width = (n / 3 * 100) + '%';
        };

        window._suUpdateRole = () => {
            const v = document.getElementById('su-role')?.value || '';
            state.targetRole = v;
            const el = document.getElementById('su-sum-role');
            if (el) { el.textContent = v.trim() || 'Not set'; el.classList.toggle('empty', !v.trim()); }
            const btn = document.getElementById('su-next1');
            if (btn) btn.disabled = !v.trim();
        };

        window._suSelectMod = (id, card) => {
            state.selectedModule = id;
            document.querySelectorAll('.su-mod').forEach(c => c.classList.remove('sel'));
            card.classList.add('sel');
            const mod = SETUP_MODS.find(m => m.id === id);
            const el = document.getElementById('su-sum-mod');
            if (el && mod) { el.textContent = mod.title; el.classList.remove('empty'); }
            const btn = document.getElementById('su-next2');
            if (btn) btn.disabled = false;
        };

        window._suChar = (i) => { if (!stressMode) { setupCharIdx = i; renderSetupChars(); } };

        window._suVoice = (btn, v) => {
            document.querySelectorAll('.su-vt').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            setupVoice = v;
            renderSetupChars();
        };

        window._suDiff = (btn, d, cls) => {
            if (stressMode) return;
            state.difficulty = d;
            btn.parentElement.querySelectorAll('.su-tgl').forEach(b => b.className = 'su-tgl');
            btn.className = 'su-tgl ' + cls;
            const el = document.getElementById('su-sum-diff');
            if (el) el.textContent = d.charAt(0).toUpperCase() + d.slice(1);
        };

        window._suDur = (btn, d, label) => {
            if (stressMode) return;
            state.duration = d;
            btn.parentElement.querySelectorAll('.su-tgl').forEach(b => b.className = 'su-tgl');
            btn.className = 'su-tgl on-amb';
            const el = document.getElementById('su-sum-dur');
            if (el) el.textContent = label;
        };

        window._suInd = (btn, id, label) => {
            state.industry = id;
            document.querySelectorAll('.su-ind').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            const el = document.getElementById('su-sum-ind');
            if (el) el.textContent = label;
        };

        window._suToggleSw = (sw) => { sw.classList.toggle('on'); };

        window._suToggleStress = () => {
            stressMode = !stressMode;
            const sw = document.getElementById('su-stress-sw');
            const banner = document.getElementById('su-stress-banner');
            const alert = document.getElementById('su-stress-alert');
            const intSw = document.getElementById('su-int-sw');
            if (sw) sw.classList.toggle('on', stressMode);
            if (banner) banner.classList.toggle('on', stressMode);
            if (alert) alert.classList.toggle('show', stressMode);
            const diffBtns = document.querySelectorAll('#su-diff-grp .su-tgl');
            const durBtns = document.querySelectorAll('#su-dur-grp .su-tgl');
            if (stressMode) {
                setupCharIdx = 2;
                diffBtns.forEach(b => b.className = 'su-tgl locked');
                diffBtns[2].className = 'su-tgl on-hard locked';
                durBtns.forEach(b => b.className = 'su-tgl locked');
                durBtns[2].className = 'su-tgl on-amb locked';
                state.difficulty = 'hard'; state.duration = 'extended'; state.interruptionsEnabled = true;
                if (intSw) { intSw.classList.add('locked-on'); intSw.classList.remove('on'); }
                const sd = document.getElementById('su-sum-diff'); if (sd) sd.textContent = 'Hard';
                const su = document.getElementById('su-sum-dur'); if (su) su.textContent = 'Extended (20 Qs)';
            } else {
                diffBtns.forEach(b => b.classList.remove('locked'));
                durBtns.forEach(b => b.classList.remove('locked'));
                if (intSw) intSw.classList.remove('locked-on');
            }
            renderSetupChars();
        };

        window._suResTab = (tab, btn) => {
            document.querySelectorAll('.su-res-tab').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
            const u = document.getElementById('su-tab-upload');
            const p = document.getElementById('su-tab-paste');
            if (u) u.style.display = tab === 'upload' ? 'block' : 'none';
            if (p) p.style.display = tab === 'paste' ? 'block' : 'none';
        };

        window._suLaunch = async () => {
            if (!setupRuntime.data?.ready) {
                setupRuntime.error = setupRuntime.data?.status_message || `Local AI is not ready. Start Ollama and install ${LOCAL_MODEL}.`;
                renderSetupRuntime();
                if (!setupRuntime.loading && !setupRuntime.pulling) {
                    await window._suRefreshRuntime();
                }
                if (!setupRuntime.data?.ready) return;
            }
            state.targetRole = document.getElementById('su-role')?.value || '';
            state.jobDescription = document.getElementById('su-jd')?.value || '';
            const pasteResume = document.getElementById('su-resume-text')?.value || '';
            if (pasteResume) state.resumeText = pasteResume;
            state.faangMode = document.getElementById('su-faang-sw')?.classList.contains('on') || false;
            state.interruptionsEnabled = document.getElementById('su-int-sw')?.classList.contains('on') || document.getElementById('su-int-sw')?.classList.contains('locked-on') || false;
            // Track industries used
            const used = JSON.parse(localStorage.getItem('ai_coach_industries_used') || '[]');
            if (!used.includes(state.industry)) { used.push(state.industry); localStorage.setItem('ai_coach_industries_used', JSON.stringify(used)); }
            if (state.faangMode) { localStorage.setItem('ai_coach_faang_sessions', JSON.stringify((JSON.parse(localStorage.getItem('ai_coach_faang_sessions') || '0')) + 1)); }
            navigate('session');
        };
    }

    function renderSession() {
        // --- Derive dynamic session info ---
        const SETUP_CHARS = {
            female: [
                { id: 'strict', name: 'Victoria' }, { id: 'friendly', name: 'Sophie' },
                { id: 'stress', name: 'Elena' }, { id: 'calm', name: 'Maya' },
                { id: 'executive', name: 'Diana' }, { id: 'peer', name: 'Jess' }
            ],
            male: [
                { id: 'strict', name: 'Marcus' }, { id: 'friendly', name: 'James' },
                { id: 'stress', name: 'Tyler' }, { id: 'calm', name: 'Nathan' },
                { id: 'executive', name: 'Richard' }, { id: 'peer', name: 'Alex' }
            ]
        };
        const MOD_COLORS = {
            general: { color: '99,102,241', hex: '#6366f1', label: 'General Interview', icon: 'layers-intersect' },
            roleplay: { color: '168,85,247', hex: '#a855f7', label: 'Roleplay & Behavioral', icon: 'messages' },
            technical: { color: '59,130,246', hex: '#3b82f6', label: 'Technical Assessment', icon: 'code' },
            visual: { color: '20,184,166', hex: '#14b8a6', label: 'Visual & Whiteboard', icon: 'presentation' },
            casestudy: { color: '236,72,153', hex: '#ec4899', label: 'Case Study & Strategy', icon: 'chart-dots-3' },
            salary: { color: '34,197,94', hex: '#22c55e', label: 'Salary Negotiation', icon: 'cash' }
        };
        // Word count thresholds per module (min for "Ok", min for "Strong")
        const WC_THRESHOLDS = {
            general: [30, 60], roleplay: [25, 55], technical: [20, 45],
            visual: [25, 50], casestudy: [35, 70], salary: [20, 45]
        };

        const mod = MOD_COLORS[state.selectedModule] || MOD_COLORS.general;
        const charList = SETUP_CHARS[state.interviewerPersona?.gender || 'female'];
        const charData = charList.find(c => c.id === state.interviewerPersona?.character) || charList[1];
        const charInitial = charData.name.charAt(0);
        const charName = charData.name;
        const charRole = characters.find(c => c.id === state.interviewerPersona?.character)?.label || 'Interviewer';
        const modLabel = mod.label;
        const modIcon = mod.icon;
        const mc = mod.color; // e.g. "168,85,247"
        const mh = mod.hex;   // e.g. "#a855f7"
        const portraitSrc = state.interviewerPersona?.gender === 'male'
            ? '/static/assets/interviewers/interviewer-male.png'
            : '/static/assets/interviewers/interviewer-female.png';

        const sessionCSS = `
        <style>
        /* -- SESSION RESET -- */
        .ss-wrap{position:relative;display:flex;flex-direction:column;height:100vh;background:var(--t-bg-solid);font-family:'Inter',system-ui,sans-serif;color:var(--t-fg);overflow:hidden}

        /* -- HEADER -- */
        .ss-hdr{display:flex;align-items:center;justify-content:space-between;padding:0 20px;height:60px;flex-shrink:0;background:var(--t-surface2);border-bottom:1px solid var(--t-border);backdrop-filter:blur(12px);z-index:30}
        .ss-hdr-left{display:flex;align-items:center;gap:12px}
        .ss-back{width:32px;height:32px;border-radius:8px;border:none;background:transparent;color:var(--t-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .2s;font-size:16px;font-family:inherit}
        .ss-back:hover{background:var(--t-border);color:var(--t-fg)}
        .ss-char-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,rgba(${mc},.8),rgba(${mc},.5));display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;flex-shrink:0;position:relative;transition:box-shadow .3s}
        .ss-char-avatar .ss-speak-ring{position:absolute;inset:-4px;border-radius:50%;border:2.5px solid rgba(${mc},.6);opacity:0;pointer-events:none}
        .ss-char-avatar.speaking .ss-speak-ring{opacity:1;animation:ss-speak 1.4s ease-out infinite}
        .ss-char-avatar.thinking{animation:ss-think-pulse 1.5s ease-in-out infinite}
        @keyframes ss-speak{0%{transform:scale(1);opacity:.7}100%{transform:scale(1.4);opacity:0}}
        @keyframes ss-think-pulse{0%,100%{box-shadow:0 0 0 0 rgba(${mc},.3)}50%{box-shadow:0 0 0 8px rgba(${mc},.0)}}
        .ss-hdr-info{}
        .ss-hdr-name{font-size:13px;font-weight:700;color:var(--t-heading)}
        .ss-hdr-name span{font-weight:500;color:var(--t-muted);font-size:11px}
        .ss-hdr-role{font-size:11px;color:var(--t-muted)}
        .ss-mod-pill{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:99px;border:1px solid rgba(${mc},.3);background:rgba(${mc},.08);color:${mh};font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
        .ss-hdr-right{display:flex;align-items:center;gap:8px}
        .ss-ctrl{display:inline-flex;align-items:center;gap:5px;padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.13);background:var(--t-surface);color:var(--t-muted);font-size:11px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
        .ss-ctrl:hover{background:var(--t-border);color:var(--t-fg)}
        .ss-ctrl.amber{border-color:rgba(184,149,49,.35);color:#d4aa3f}
        .ss-ctrl.on{background:rgba(184,149,49,.08)}
        .ss-q-counter{padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.13);background:var(--t-surface);font-size:11px;font-weight:700;color:var(--t-fg)}
        .ss-q-counter span{color:var(--t-muted)}
        .ss-timer-badge{padding:6px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.13);background:var(--t-surface);font-size:12px;font-weight:700;color:var(--t-fg);font-variant-numeric:tabular-nums}
        .ss-end{padding:7px 16px;border-radius:8px;border:none;background:rgba(220,38,38,.85);color:#fff;font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;font-family:inherit;box-shadow:0 0 14px rgba(220,38,38,.35)}
        .ss-end:hover{background:rgba(220,38,38,1);box-shadow:0 0 20px rgba(220,38,38,.5)}
        .ss-end:disabled{opacity:.5;cursor:not-allowed}

        /* -- TIMER BAR -- */
        .ss-timer-bar{height:3px;background:var(--t-surface-hover);flex-shrink:0;position:relative;overflow:hidden}
        .ss-timer-bar-fill{height:100%;width:100%;transition:width .3s linear,background .5s;box-shadow:0 0 8px rgba(34,197,94,.4)}
        .ss-timer-bar-fill.green{background:linear-gradient(90deg,#22c55e,#84cc16)}
        .ss-timer-bar-fill.yellow{background:linear-gradient(90deg,#eab308,#f59e0b)}
        .ss-timer-bar-fill.red{background:linear-gradient(90deg,#ef4444,#dc2626);box-shadow:0 0 8px rgba(239,68,68,.4)}

        /* -- CHAT AREA -- */
        .ss-chat{flex:1;overflow-y:auto;padding:28px 0;display:flex;flex-direction:column;align-items:center;scrollbar-width:thin;scrollbar-color:var(--t-border) transparent}
        .ss-chat::-webkit-scrollbar{width:4px}
        .ss-chat::-webkit-scrollbar-thumb{background:var(--t-border);border-radius:2px}
        .ss-chat-inner{width:100%;max-width:720px;padding:0 20px;display:flex;flex-direction:column;gap:20px}

        /* -- MESSAGE BUBBLES -- */
        .ss-msg-ai{display:flex;align-items:flex-start;gap:12px;max-width:78%;animation:ss-bubbleIn .3s ease both}
        .ss-ai-av{width:36px;height:36px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;background:linear-gradient(135deg,rgba(${mc},.8),rgba(${mc},.5));border:1.5px solid rgba(${mc},.4)}
        .ss-ai-wrap{}
        .ss-ai-sender{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--t-muted);margin-bottom:5px;display:flex;align-items:center;gap:6px}
        .ss-curveball-tag{font-size:9px;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:#fbbf24}
        .ss-interrupt-tag{font-size:9px;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:#f59e0b}
        .ss-ai-bubble{background:rgba(${mc},.07);border:1px solid rgba(${mc},.18);border-radius:4px 18px 18px 18px;padding:14px 16px;font-size:14px;color:var(--t-fg);line-height:1.7}
        .ss-ai-bubble.interrupt{border-left:3px solid rgba(245,158,11,.6);animation:ss-shake .4s ease}
        @keyframes ss-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-4px)}40%,80%{transform:translateX(4px)}}
        .ss-ai-actions{margin-top:8px;display:flex;gap:6px}
        .ss-skip-btn{padding:4px 10px;border-radius:7px;border:1px solid var(--t-border2);background:transparent;color:var(--t-muted);font-size:11px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
        .ss-skip-btn:hover{background:var(--t-surface-hover);color:var(--t-fg)}

        .ss-msg-user{display:flex;align-items:flex-start;gap:12px;max-width:78%;align-self:flex-end;flex-direction:row-reverse;animation:ss-bubbleIn .3s ease both}
        .ss-user-av{width:36px;height:36px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;background:rgba(184,149,49,.15);border:1.5px solid rgba(184,149,49,.35);color:#d4aa3f}
        .ss-user-wrap{}
        .ss-user-sender{font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--t-muted);margin-bottom:5px;text-align:right}
        .ss-user-bubble{background:rgba(184,149,49,.06);border:1px solid rgba(184,149,49,.18);border-radius:18px 4px 18px 18px;padding:14px 16px;font-size:14px;color:var(--t-fg);line-height:1.7;text-align:left}
        .ss-wc{margin-top:7px;font-size:10px;color:var(--t-muted);text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:6px}
        .ss-wc-bar{height:3px;width:60px;background:var(--t-border);border-radius:99px;overflow:hidden}
        .ss-wc-fill{height:100%;border-radius:99px}

        /* TYPING */
        .ss-msg-typing{display:flex;align-items:flex-start;gap:12px;max-width:78%;animation:ss-bubbleIn .3s ease both}
        .ss-typing-bubble{background:rgba(${mc},.07);border:1px solid rgba(${mc},.18);border-radius:4px 18px 18px 18px;padding:16px 20px;display:flex;align-items:center;gap:5px}
        .ss-typing-dot{width:7px;height:7px;border-radius:50%;background:rgba(${mc},.5)}
        .ss-typing-dot:nth-child(1){animation:ss-bounce .9s ease-in-out infinite}
        .ss-typing-dot:nth-child(2){animation:ss-bounce .9s ease-in-out infinite .15s}
        .ss-typing-dot:nth-child(3){animation:ss-bounce .9s ease-in-out infinite .3s}
        @keyframes ss-bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-7px)}}
        @keyframes ss-bubbleIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

        /* -- VISUALIZER -- */
        .ss-visualizer{display:flex;align-items:center;gap:3px;justify-content:center;margin:4px 0 0 48px;height:20px}
        .ss-viz-bar{width:3px;border-radius:99px;background:rgba(${mc},.6)}
        .ss-viz-bar:nth-child(1){animation:ss-viz 0.8s ease-in-out infinite 0.0s}
        .ss-viz-bar:nth-child(2){animation:ss-viz 0.8s ease-in-out infinite 0.1s}
        .ss-viz-bar:nth-child(3){animation:ss-viz 0.8s ease-in-out infinite 0.2s}
        .ss-viz-bar:nth-child(4){animation:ss-viz 0.8s ease-in-out infinite 0.3s}
        .ss-viz-bar:nth-child(5){animation:ss-viz 0.8s ease-in-out infinite 0.2s}
        .ss-viz-bar:nth-child(6){animation:ss-viz 0.8s ease-in-out infinite 0.1s}
        .ss-viz-bar:nth-child(7){animation:ss-viz 0.8s ease-in-out infinite 0.0s}
        @keyframes ss-viz{0%,100%{height:4px;opacity:.4}50%{height:18px;opacity:1}}

        /* -- CAMERA PIP -- */
        .ss-pip{position:fixed;bottom:96px;right:20px;width:176px;height:132px;border-radius:16px;border:1px solid var(--t-border2);overflow:hidden;background:var(--t-surface);z-index:40;cursor:move;box-shadow:0 8px 32px rgba(0,0,0,.5);backdrop-filter:blur(8px)}
        .ss-pip.hidden{display:none}
        .ss-pip-video{width:100%;height:100%;object-fit:cover;transform:scaleX(-1)}
        .ss-pip-overlay{position:absolute;bottom:0;left:0;right:0;padding:8px 10px;background:linear-gradient(transparent,rgba(0,0,0,.5));display:flex;align-items:center;justify-content:space-between}
        .ss-pip-dot{width:6px;height:6px;border-radius:50%;background:#22c55e;box-shadow:0 0 6px rgba(34,197,94,.6);animation:ss-pip-pulse 2s ease-in-out infinite}
        @keyframes ss-pip-pulse{0%,100%{opacity:1}50%{opacity:.4}}
        .ss-pip-label{font-size:9px;font-weight:700;color:rgba(255,255,255,.7);text-transform:uppercase;letter-spacing:.06em}
        .ss-pip-cam-btn{width:22px;height:22px;border-radius:6px;background:rgba(0,0,0,.4);border:none;color:rgba(255,255,255,.7);display:flex;align-items:center;justify-content:center;font-size:11px;cursor:pointer}
        .ss-pip-off{position:absolute;inset:0;background:rgba(20,20,40,.9);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px}
        .ss-pip-off span{font-size:9px;color:var(--t-muted);text-transform:uppercase;letter-spacing:.06em;font-weight:700}

        /* -- INPUT AREA -- */
        .ss-input{flex-shrink:0;padding:14px 20px;background:var(--t-surface2);border-top:1px solid var(--t-border);backdrop-filter:blur(12px);z-index:20}
        .ss-input-inner{max-width:720px;margin:0 auto;display:flex;align-items:flex-end;gap:10px}
        .ss-mic{width:44px;height:44px;border-radius:12px;border:1px solid rgba(255,255,255,.13);background:var(--t-surface-hover);color:var(--t-muted);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:18px;transition:all .2s;flex-shrink:0;position:relative;font-family:inherit}
        .ss-mic:hover{background:rgba(255,255,255,.09);color:var(--t-fg)}
        .ss-mic.active{background:rgba(220,38,38,.1);border-color:rgba(220,38,38,.4);color:#f87171}
        .ss-mic-ping{position:absolute;inset:0;border-radius:12px;background:rgba(220,38,38,.2);animation:ss-ping 1s ease-out infinite;display:none}
        .ss-mic.active .ss-mic-ping{display:block}
        @keyframes ss-ping{0%{transform:scale(1);opacity:.6}100%{transform:scale(1.4);opacity:0}}
        .ss-textarea{flex:1;background:var(--t-surface);border:1px solid rgba(255,255,255,.13);border-radius:12px;padding:12px 16px;font-size:14px;color:var(--t-fg);outline:none;font-family:inherit;resize:none;min-height:44px;max-height:120px;line-height:1.55;transition:border-color .2s,box-shadow .2s}
        .ss-textarea:focus{border-color:rgba(184,149,49,.4);box-shadow:0 0 0 3px rgba(184,149,49,.07)}
        .ss-textarea::placeholder{color:var(--t-muted)}
        .ss-send{width:44px;height:44px;border-radius:12px;border:none;background:linear-gradient(135deg,#b89531,#d4aa3f);color:#000;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;flex-shrink:0;transition:all .2s;box-shadow:0 0 14px rgba(184,149,49,.3)}
        .ss-send:hover{transform:translateY(-1px);box-shadow:0 4px 20px rgba(184,149,49,.45)}
        .ss-resp-hint{font-size:11px;color:var(--t-muted);text-align:center;margin-top:6px;max-width:720px;margin-left:auto;margin-right:auto}
        .ss-resp-hint strong{color:var(--t-fg)}
        .ss-live-wc{font-size:10px;color:var(--t-muted);text-align:right;margin-top:4px;max-width:720px;margin-left:auto;margin-right:auto;min-height:14px;transition:color .2s}

        /* -- END SESSION MODAL -- */
        .ss-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(6px);z-index:100;display:flex;align-items:center;justify-content:center;animation:ss-fadeIn .2s ease}
        .ss-modal{background:rgba(15,15,24,.98);border:1px solid var(--t-border2);border-radius:20px;padding:32px;max-width:420px;width:90%;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.6);animation:ss-modalIn .3s ease}
        @keyframes ss-fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes ss-modalIn{from{opacity:0;transform:scale(.95) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
        .ss-modal-ico{font-size:40px;margin-bottom:16px}
        .ss-modal h3{font-size:20px;font-weight:800;color:var(--t-heading);margin-bottom:8px}
        .ss-modal p{font-size:14px;color:var(--t-muted);line-height:1.6;margin-bottom:24px}
        .ss-modal-btns{display:flex;gap:10px;justify-content:center}
        .ss-modal-cancel{padding:12px 24px;border-radius:10px;border:1px solid rgba(255,255,255,.13);background:transparent;color:var(--t-muted);font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
        .ss-modal-cancel:hover{border-color:var(--t-border2);color:var(--t-fg)}
        .ss-modal-confirm{padding:12px 24px;border-radius:10px;border:none;background:rgba(220,38,38,.85);color:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:all .2s;font-family:inherit;box-shadow:0 0 14px rgba(220,38,38,.3)}
        .ss-modal-confirm:hover{background:rgba(220,38,38,1);box-shadow:0 0 20px rgba(220,38,38,.5)}
        .ss-modal-confirm:disabled{opacity:.5;cursor:not-allowed}
        </style>`;

        mainContent.innerHTML = sessionCSS + `
        <div class="studio-camera-pip hidden" id="camera-pip-container" aria-label="Your camera preview">
            <video class="studio-camera-pip__video" id="self-camera-preview" autoplay muted playsinline></video>
            <div class="studio-camera-pip__bar">
                <span class="studio-camera-pip__label">Your camera</span>
                <button class="studio-camera-pip__button" id="camera-toggle-btn" aria-label="Toggle camera">${ti('camera')}</button>
            </div>
            <div class="studio-camera-pip__off hidden" id="camera-off-overlay">
                <span aria-hidden="true">${ti('camera-off')}</span>
                <span>Camera off</span>
            </div>
        </div>

        <main class="studio-ui studio-session">
            <header class="studio-session__header">
                <div class="studio-session__brand">
                    <button class="studio-icon-button" onclick="window.nav('setup')" title="Back to setup" aria-label="Back to setup">${ti('arrow-left')}</button>
                    <div class="studio-session__brand-copy">
                        <h1 class="studio-session__title">The Interview Room</h1>
                        <span class="studio-session__divider" aria-hidden="true"></span>
                        <span class="studio-session__module">${escapeHTML(modLabel)} · ${escapeHTML(state.targetRole || 'General Candidate')}</span>
                    </div>
                </div>
                <div class="studio-session__controls">
                    <span class="studio-session__live">Live rehearsal</span>
                    <span class="studio-session__divider" aria-hidden="true"></span>
                    <button class="studio-paper-button is-on" id="voice-toggle">${ti('volume')} <span class="studio-control-copy">Voice on</span></button>
                    <button class="studio-paper-button" id="mirror-toggle">${ti('eye-off')} <span class="studio-control-copy">Mirror off</span></button>
                    <div class="studio-session__counter" id="q-counter">Q <span>0</span> / ?</div>
                    <div class="studio-session__timer" id="session-timer">0:00</div>
                    <span id="response-timer" hidden>0:00</span>
                    <button class="studio-danger-button" id="end-session-btn">${ti('player-stop')} <span class="studio-control-copy">End session</span></button>
                </div>
            </header>

            <div class="studio-session__body">
                <section class="studio-stage" aria-label="Interviewer stage">
                    <div class="studio-stage__portrait" id="char-avatar" data-state="idle">
                        <img src="${portraitSrc}" alt="${escapeHTML(charName)}, your interviewer">
                    </div>
                    <div class="studio-stage__corner-label">Private · Local AI</div>
                    <div class="studio-stage__details">
                        <h2 class="studio-stage__name">${escapeHTML(charName)}</h2>
                        <p class="studio-stage__role">${escapeHTML(charRole)} interviewer · ${escapeHTML(state.targetRole || 'Interview rehearsal')}</p>
                        <div class="studio-stage__status-row">
                            <span class="studio-stage__state" id="interviewer-state-label">Ready</span>
                            <div class="studio-stage__audio-actions" id="interviewer-audio-actions" aria-live="polite"></div>
                        </div>
                    </div>
                </section>

                <section class="studio-workspace" aria-label="Interview workspace">
                    <div class="studio-question">
                        <div class="studio-question__topline">
                            <span class="studio-kicker" id="current-question-label">Current question</span>
                            <span class="studio-question__timer">Answer window · <strong id="resp-timer-display">0:00</strong></span>
                        </div>
                        <div class="studio-question__text is-thinking" id="current-question" aria-live="polite">Preparing your first question…</div>
                        <div class="studio-question__progress" aria-hidden="true">
                            <div class="studio-question__progress-fill green" id="answer-timer-bar"></div>
                        </div>
                    </div>

                    <div class="studio-response">
                        <div class="studio-response__heading">
                            <span class="studio-kicker">Your response</span>
                            <span class="studio-response__timing" id="resp-hint">Average response · <span id="avg-resp-display">—</span></span>
                        </div>
                        <div class="studio-response__composer">
                            <button class="studio-response__mic" id="mic-btn" title="Voice input" aria-label="Start voice input">${ti('microphone')}<span class="ss-mic-ping"></span></button>
                            <textarea class="studio-response__textarea" id="chat-input" placeholder="Answer naturally. Your notes stay on this machine." rows="2"></textarea>
                            <button class="studio-response__send" id="chat-send" title="Send response" aria-label="Send response">${ti('arrow-up')}</button>
                        </div>
                        <div class="studio-response__footer">
                            <span>Enter to send · Shift + Enter for a new line</span>
                            <span class="studio-response__wordcount" id="live-wc"></span>
                        </div>
                    </div>

                    <div class="studio-transcript" id="chat-area">
                        <div class="studio-transcript__header">
                            <span class="studio-rule-label studio-kicker">Session record</span>
                            <span class="studio-transcript__count" id="transcript-count">No exchanges yet</span>
                        </div>
                        <div id="chat-history">
                            <div class="studio-transcript__empty">Your completed exchanges will be filed here as the rehearsal progresses.</div>
                        </div>
                    </div>
                </section>
            </div>

            <aside class="studio-coach" aria-label="Live coaching notes">
                <div class="studio-coach__intro">
                    <span class="studio-kicker">Live coach</span>
                    <span class="studio-coach__note" id="coach-note">Settle in. Answer the question you were asked.</span>
                </div>
                <div class="studio-coach__metric">
                    <span class="studio-coach__metric-label">Response pace</span>
                    <span class="studio-coach__metric-value" id="coach-pace">Waiting</span>
                </div>
                <div class="studio-coach__metric">
                    <span class="studio-coach__metric-label">Specificity</span>
                    <span class="studio-coach__metric-value" id="coach-specificity">Not enough text</span>
                </div>
                <div class="studio-coach__metric">
                    <span class="studio-coach__metric-label">Structure</span>
                    <span class="studio-coach__metric-value" id="coach-structure">Forming</span>
                </div>
                <div class="studio-coach__metric">
                    <span class="studio-coach__metric-label">Presence</span>
                    <span class="studio-coach__metric-value" id="coach-presence">Camera optional</span>
                </div>
            </aside>
        </main>`;

        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');
        const chatHistoryBlock = document.getElementById('chat-history');
        const interviewerVisual = window.InterviewerVisual?.create({
            rootId: 'char-avatar',
            labelId: 'interviewer-state-label',
            initialState: 'idle',
        });

        // Auto-start camera
        if (state.cameraEnabled) {
            startCamera();
            // Initialize body language analysis after camera starts
            if (window.BodyLanguageAnalyzer) {
                window.BodyLanguageAnalyzer.init().then(ok => {
                    if (ok) {
                        // Wait for video element to be ready, then start analysis
                        const checkVideo = setInterval(() => {
                            const vid = document.getElementById('self-camera-preview');
                            if (vid && vid.readyState >= 2) {
                                clearInterval(checkVideo);
                                window.BodyLanguageAnalyzer.start(vid);
                                console.log('[Session] Body language analysis active (silent mode)');
                            }
                        }, 500);
                    }
                });
            }
        }

        // --- Camera Toggle & Blind Mirror Logic ---
        const mirrorToggle = document.getElementById('mirror-toggle');
        const cameraPip = document.getElementById('camera-pip-container');

        if (mirrorToggle && cameraPip) {
            mirrorToggle.onclick = () => {
                state.blindMirror = !state.blindMirror;
                if (state.blindMirror) {
                    cameraPip.classList.add('hidden');
                    mirrorToggle.innerHTML = `${ti('eye-off')} <span class="studio-control-copy">Mirror off</span>`;
                    mirrorToggle.classList.remove('is-on');
                } else {
                    cameraPip.classList.remove('hidden');
                    mirrorToggle.innerHTML = `${ti('eye')} <span class="studio-control-copy">Mirror on</span>`;
                    mirrorToggle.classList.add('is-on');
                    if (!state.cameraStream && state.cameraEnabled) startCamera();
                }
            };
            // Set initial state
            if (!state.blindMirror) {
                cameraPip.classList.remove('hidden');
                mirrorToggle.innerHTML = `${ti('eye')} <span class="studio-control-copy">Mirror on</span>`;
                mirrorToggle.classList.add('is-on');
            }
        }

        const cameraToggleBtn = document.getElementById('camera-toggle-btn');
        if (cameraToggleBtn) {
            cameraToggleBtn.onclick = (e) => {
                e.stopPropagation();
                state.cameraEnabled = !state.cameraEnabled;
                const video = document.getElementById('self-camera-preview');
                const offOverlay = document.getElementById('camera-off-overlay');
                if (state.cameraEnabled) {
                    if (video) video.style.opacity = '1';
                    if (offOverlay) offOverlay.classList.add('hidden');
                    cameraToggleBtn.innerHTML = ti('camera');
                    if (!state.cameraStream) startCamera();
                } else {
                    if (video) video.style.opacity = '0';
                    if (offOverlay) offOverlay.classList.remove('hidden');
                    cameraToggleBtn.innerHTML = ti('camera-off');
                }
            };
        }

        // --- Draggable PIP Logic ---
        if (cameraPip) {
            let isDragging = false;
            let currentX, currentY, initialX, initialY, xOffset = 0, yOffset = 0;
            cameraPip.addEventListener('mousedown', dragStart);
            document.addEventListener('mousemove', drag);
            document.addEventListener('mouseup', dragEnd);
            function dragStart(e) {
                initialX = e.clientX - xOffset;
                initialY = e.clientY - yOffset;
                if (e.target === cameraPip || cameraPip.contains(e.target)) isDragging = true;
            }
            function drag(e) {
                if (!isDragging) return;
                e.preventDefault();
                currentX = e.clientX - initialX;
                currentY = e.clientY - initialY;
                xOffset = currentX; yOffset = currentY;
                cameraPip.style.transform = `translate3d(${currentX}px, ${currentY}px, 0)`;
            }
            function dragEnd() { isDragging = false; }
        }

        state.chatHistory = [];
        state.currentSessionId = crypto.randomUUID();
        state.voiceMode = true;
        state.isRecording = false;
        state.currentAudio = null;

        let sessionStartTime = Date.now();
        let lastResponseTime = Date.now();
        let lastActivityTime = Date.now();
        let nudgeSent = false;
        let isAITalking = false;
        let sessionBlocked = false;
        let aiTurnCount = 0;
        let curveballFired = false;
        let nextInterruptAt = null;
        let userResponseTimes = []; // Track response times for avg display

        const INTERRUPT_LINES = {
            strict: ["Let me stop you there - give me the short version.", "I'll need you to cut to the point.", "Skip ahead - what's the key takeaway?"],
            friendly: ["Sorry to jump in! Can you give me the gist of that?", "Oh, before you finish - what's the main point?", "Quick check-in - can you summarise that?"],
            stress: ["Stop. What's the bottom line?", "I'm going to cut you off - key point, now.", "Wrap it up in one sentence."],
            analytical: ["Pause - what's the core assumption you're making?", "Hold on, let's zoom out - what's the crux here?", "Let me interject - what evidence supports that?"],
            panel: ["I'll interject - other panellists may have questions. Quick summary?", "Let's pause you there. What's the headline?", "I need to flag something - can you abbreviate?"],
            peer: ["Oh wait, actually - what's the TL;DR on that?", "Ha, sorry - can you give me the quick version?", "Hold that thought - just the highlight?"]
        };

        const difficultyLimits = { easy: 60, medium: 120, hard: 180 };
        const turnLimit = difficultyLimits[state.difficulty] || 120;

        function scheduleNextInterruption() {
            if (!state.interruptionsEnabled) return;
            const delay = (30 + Math.random() * 60) * 1000;
            nextInterruptAt = Date.now() + delay;
        }
        scheduleNextInterruption();

        // --- Q counter helpers ---
        const totalQs = { quick: 5, standard: 10, extended: 20 }[state.duration] || 10;
        function updateQCounter() {
            const aiMsgs = state.chatHistory.filter(m => m.role === 'assistant' && !m.isNudge && !m.isTyping && !m.isInterruption && !m.isSystemError).length;
            const el = document.getElementById('q-counter');
            if (el) el.innerHTML = `Q <span>${aiMsgs}</span> / ${totalQs}`;
        }

        // --- Timers ---
        const sessionTimerEl = document.getElementById('session-timer');
        const responseTimerEl = document.getElementById('response-timer');
        const respTimerDisplay = document.getElementById('resp-timer-display');
        const avgRespDisplay = document.getElementById('avg-resp-display');
        const coachPace = document.getElementById('coach-pace');
        const coachSpecificity = document.getElementById('coach-specificity');
        const coachStructure = document.getElementById('coach-structure');
        const coachPresence = document.getElementById('coach-presence');
        const coachNote = document.getElementById('coach-note');
        let lastCoachUpdate = 0;

        function setCoachMetric(element, text, tone = '') {
            if (!element) return;
            element.textContent = text;
            element.classList.remove('is-good', 'is-caution', 'is-alert');
            if (tone) element.classList.add(tone);
        }

        function updateLiveCoaching(responseSeconds = 0) {
            if (sessionBlocked) {
                setCoachMetric(coachPace, 'Session paused', 'is-alert');
                setCoachMetric(coachSpecificity, 'Waiting for AI');
                setCoachMetric(coachStructure, 'Waiting for AI');
                setCoachMetric(coachPresence, window.BodyLanguageAnalyzer?.isActive() ? 'Local camera active' : 'Camera optional', window.BodyLanguageAnalyzer?.isActive() ? 'is-good' : '');
                if (coachNote) coachNote.textContent = 'Ollama is open, but the selected model is not accepting chat. Return to setup after fixing the model.';
                return;
            }
            const draft = chatInput.value.trim();
            const signals = scoreTextSignals(draft);
            const words = signals.word_count;

            if (!words) {
                setCoachMetric(coachPace, isAITalking ? 'Interviewer speaking' : 'Waiting');
                setCoachMetric(coachSpecificity, 'Not enough text');
                setCoachMetric(coachStructure, 'Forming');
                if (coachNote) coachNote.textContent = isAITalking
                    ? 'Listen for the exact question before you shape the answer.'
                    : 'Settle in. Answer the question you were asked.';
            } else {
                const wpm = responseSeconds > 3 ? Math.round(words / responseSeconds * 60) : 0;
                if (!wpm) setCoachMetric(coachPace, `${words} words drafted`);
                else if (wpm < 85) setCoachMetric(coachPace, `${wpm} wpm · deliberate`, 'is-caution');
                else if (wpm <= 175) setCoachMetric(coachPace, `${wpm} wpm · measured`, 'is-good');
                else setCoachMetric(coachPace, `${wpm} wpm · quick`, 'is-alert');

                const specificityPoints =
                    Math.min(signals.metric_count, 2) * 2 +
                    Math.min(signals.action_verb_count, 2) +
                    (signals.has_outcome ? 2 : 0) +
                    (signals.has_first_person ? 1 : 0);
                if (specificityPoints >= 5) setCoachMetric(coachSpecificity, 'Concrete evidence', 'is-good');
                else if (specificityPoints >= 2) setCoachMetric(coachSpecificity, 'Some detail', 'is-caution');
                else setCoachMetric(coachSpecificity, 'Add an example', 'is-alert');

                const structurePoints = [
                    signals.has_constraint,
                    signals.has_action_verb,
                    signals.has_outcome,
                    signals.has_first_person,
                ].filter(Boolean).length;
                if (structurePoints >= 3) setCoachMetric(coachStructure, 'Clear answer arc', 'is-good');
                else if (structurePoints >= 2) setCoachMetric(coachStructure, 'Partial answer arc', 'is-caution');
                else setCoachMetric(coachStructure, 'Forming', 'is-alert');

                if (coachNote) {
                    if (signals.filler_count > 1) coachNote.textContent = 'Pause once. Remove the filler and lead with your point.';
                    else if (!signals.has_outcome && words > 35) coachNote.textContent = 'You have the setup. Land the result or impact.';
                    else if (!signals.has_first_person && words > 25) coachNote.textContent = 'Make your own contribution explicit: what did you do?';
                    else coachNote.textContent = 'Good. Keep the evidence tied to the question.';
                }
            }

            if (window.BodyLanguageAnalyzer?.isActive()) {
                const presence = window.BodyLanguageAnalyzer.getRealtimeMetrics();
                if (presence) {
                    const values = [presence.eye_contact, presence.posture].filter(Number.isFinite);
                    const average = values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
                    if (average >= 70) setCoachMetric(coachPresence, `${average} · steady`, 'is-good');
                    else if (average >= 45) setCoachMetric(coachPresence, `${average} · settling`, 'is-caution');
                    else setCoachMetric(coachPresence, `${average} · reset posture`, 'is-alert');
                }
            } else {
                setCoachMetric(coachPresence, state.cameraEnabled ? 'Starting locally' : 'Camera optional');
            }
        }

        function formatTime(seconds) {
            const m = Math.floor(seconds / 60);
            const s = Math.floor(seconds % 60);
            return `${m}:${s.toString().padStart(2, '0')}`;
        }

        if (window.sessionInterval) clearInterval(window.sessionInterval);
        window.sessionInterval = setInterval(() => {
            if (!sessionTimerEl) return clearInterval(window.sessionInterval);
            const now = Date.now();
            const sessionSeconds = (now - sessionStartTime) / 1000;
            const responseSeconds = (now - lastResponseTime) / 1000;
            const inactivitySeconds = (now - lastActivityTime) / 1000;

            if (now - lastCoachUpdate >= 500) {
                lastCoachUpdate = now;
                updateLiveCoaching(responseSeconds);
            }

            sessionTimerEl.textContent = formatTime(sessionSeconds);
            if (responseTimerEl) responseTimerEl.textContent = formatTime(responseSeconds);
            if (respTimerDisplay) respTimerDisplay.textContent = formatTime(responseSeconds);

            // Update timer bar
            const timerBar = document.getElementById('answer-timer-bar');
            if (timerBar && !isAITalking && !sessionBlocked) {
                const remainingSeconds = Math.max(turnLimit - responseSeconds, 0);
                const percentage = (remainingSeconds / turnLimit) * 100;
                timerBar.style.width = `${percentage}%`;

                if (remainingSeconds > turnLimit * 0.5) {
                    timerBar.className = 'studio-question__progress-fill green';
                } else if (remainingSeconds > 15) {
                    timerBar.className = 'studio-question__progress-fill yellow';
                } else {
                    timerBar.className = 'studio-question__progress-fill red';
                }

                // Silence Detection (60s)
                if (inactivitySeconds > 60 && !nudgeSent && remainingSeconds > 5) {
                    const nudgeChar = characters.find(c => c.id === state.interviewerPersona.character) || characters[1];
                    state.chatHistory.push({ role: 'assistant', content: nudgeChar.nudge, isNudge: true, timestamp: Date.now() });
                    triggerAIResponse(true, nudgeChar.nudge);
                }

                // Interruption Simulation
                if (state.interruptionsEnabled && nextInterruptAt && now >= nextInterruptAt && !isAITalking) {
                    nextInterruptAt = null;
                    const charId = state.interviewerPersona.character;
                    const lines = INTERRUPT_LINES[charId] || INTERRUPT_LINES['friendly'];
                    const line = lines[Math.floor(Math.random() * lines.length)];
                    state.chatHistory.push({ role: 'assistant', content: line, isInterruption: true, timestamp: Date.now() });
                    updateChatView();
                    handleTTS(line, true);
                }

                // Timeout Detection
                if (remainingSeconds <= 0) {
                    isAITalking = true;
                    state.chatHistory.push({
                        role: 'user',
                        content: '[TIMEOUT: The candidate ran out of time for this question. Acknowledge this appropriately and move to the next question or topic.]',
                        isHidden: true,
                        isTimeout: true,
                        timestamp: Date.now()
                    });
                    triggerAIResponse(false);
                }
            } else if (timerBar && (isAITalking || sessionBlocked)) {
                timerBar.style.width = '100%';
                timerBar.className = 'studio-question__progress-fill green';
            }
        }, 100);

        // --- Voice Toggle ---
        const voiceToggleBtn = document.getElementById('voice-toggle');
        voiceToggleBtn.addEventListener('click', () => {
            state.voiceMode = !state.voiceMode;
            if (state.voiceMode) {
                voiceToggleBtn.innerHTML = `${ti('volume')} <span class="studio-control-copy">Voice on</span>`;
                voiceToggleBtn.classList.add('is-on');
            } else {
                voiceToggleBtn.innerHTML = `${ti('volume-off')} <span class="studio-control-copy">Voice off</span>`;
                voiceToggleBtn.classList.remove('is-on');
                if (state.currentAudio) state.currentAudio.pause();
                interviewerVisual?.setState('idle');
                const audioActions = document.getElementById('interviewer-audio-actions');
                if (audioActions) audioActions.innerHTML = '';
            }
        });

        // --- Mic STT ---
        const micBtn = document.getElementById('mic-btn');
        let mediaRecorder = null;
        let audioChunks = [];

        micBtn.addEventListener('click', async () => {
            if (state.isRecording) { mediaRecorder.stop(); return; }
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];
                mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
                mediaRecorder.onstart = () => {
                    state.isRecording = true;
                    micBtn.classList.add('active');
                    interviewerVisual?.setState('listening');
                    chatInput.placeholder = 'Listening... click mic to stop';
                };
                mediaRecorder.onstop = async () => {
                    state.isRecording = false;
                    micBtn.classList.remove('active');
                    chatInput.placeholder = 'Transcribing...';
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const formData = new FormData();
                    formData.append('file', audioBlob, 'record.webm');
                    try {
                        const res = await fetch('/api/stt', { method: 'POST', body: formData });
                        const data = await res.json();
                        let text = (data.text || "").trim();
                        const lower = text.toLowerCase();
                        if (["you", "you.", "thank you.", "thanks for watching.", "bye."].includes(lower)) text = "";
                        if (text) chatInput.value += (chatInput.value ? ' ' : '') + text;
                        // Trigger live wc update
                        chatInput.dispatchEvent(new Event('input'));
                    } catch (e) { console.error('STT error', e); }
                    finally {
                        chatInput.placeholder = 'Answer naturally. Your notes stay on this machine.';
                        interviewerVisual?.setState(chatInput.value.trim() ? 'listening' : 'idle');
                        stream.getTracks().forEach(t => t.stop());
                    }
                };
                mediaRecorder.start();
            } catch (err) { alert('Microphone access denied or not available.'); }
        });

        // --- Live Word Count Preview ---
        const liveWcEl = document.getElementById('live-wc');
        chatInput.addEventListener('input', () => {
            lastActivityTime = Date.now();
            const words = chatInput.value.trim().split(/\s+/).filter(Boolean).length;
            if (!isAITalking && !state.currentAudio) interviewerVisual?.setState(words ? 'listening' : 'idle');
            updateLiveCoaching((Date.now() - lastResponseTime) / 1000);
            if (words === 0) { liveWcEl.textContent = ''; return; }
            const [okThresh, strongThresh] = WC_THRESHOLDS[state.selectedModule] || [30, 60];
            let label, color;
            if (words >= strongThresh) { label = 'developed'; color = 'var(--forest)'; }
            else if (words >= okThresh) { label = 'taking shape'; color = 'var(--ochre)'; }
            else { label = 'brief'; color = 'var(--ink-faint)'; }
            liveWcEl.innerHTML = `${words} words · <strong style="color:${color}">${label}</strong>`;
        });

        // --- Chat Rendering ---
        async function streamChat(model, messages, systemPrompt, onUpdate, onComplete) {
            try {
                const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, messages, system_prompt: systemPrompt }) });
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let fullText = "";
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    fullText += decoder.decode(value, { stream: true });
                    onUpdate(fullText);
                }
                onComplete(fullText);
            } catch (e) { onComplete("Local AI connection failed. Start Ollama and confirm qwen2.5:7b is installed, then retry."); }
        }

        function updateChatView() {
            if (state.chatHistory.length === 0) return;
            const currentQuestionEl = document.getElementById('current-question');
            const currentQuestionLabel = document.getElementById('current-question-label');
            const transcriptCount = document.getElementById('transcript-count');
            const visibleMessages = state.chatHistory.filter(msg => !msg.isHidden && !msg.isNudge);
            const latestAI = [...visibleMessages].reverse().find(msg => msg.role === 'assistant');
            const isThinking = state.chatHistory.some(m => m.isTyping);
            if (isThinking && !state.currentAudio) interviewerVisual?.setState('thinking');

            if (currentQuestionEl && latestAI) {
                const waitingForCopy = latestAI.isTyping && (!latestAI.content || latestAI.content === '...');
                currentQuestionEl.textContent = waitingForCopy ? 'Preparing the next question…' : latestAI.content;
                currentQuestionEl.classList.toggle('is-thinking', waitingForCopy);
                currentQuestionEl.classList.toggle('is-error', !!latestAI.isSystemError);
                if (currentQuestionLabel) {
                    currentQuestionLabel.textContent = latestAI.isSystemError
                        ? 'Local AI needs attention'
                        : latestAI.isCurveball
                        ? 'Curveball question'
                        : latestAI.isInterruption
                            ? 'Interviewer interruption'
                            : 'Current question';
                }
            }

            const filedMessages = visibleMessages.filter(msg => msg !== latestAI && !msg.isTyping);
            const completedResponses = filedMessages.filter(msg => msg.role === 'user').length;
            if (transcriptCount) {
                transcriptCount.textContent = completedResponses
                    ? `${completedResponses} response${completedResponses === 1 ? '' : 's'} filed`
                    : 'No exchanges yet';
            }

            chatHistoryBlock.innerHTML = filedMessages.length ? filedMessages.map(msg => {
                const isAI = msg.role === 'assistant';
                const isInterrupt = !!msg.isInterruption;
                const isCurveball = !!msg.isCurveball;
                const contentHTML = escapeHTML(msg.content || '');
                const words = isAI ? 0 : (msg.content || '').split(/\s+/).filter(Boolean).length;
                const note = isAI
                    ? [isCurveball ? 'Curveball' : '', isInterrupt ? 'Interruption' : ''].filter(Boolean).join(' · ')
                    : `${words} words`;

                return `<article class="studio-transcript-entry ${isAI ? 'studio-transcript-entry--question' : 'studio-transcript-entry--response'}">
                    <div class="studio-transcript-entry__label">${isAI ? escapeHTML(charName) : 'Your response'}</div>
                    <div>
                        <div class="studio-transcript-entry__copy">${contentHTML}</div>
                        ${note ? `<div class="studio-transcript-entry__meta">${escapeHTML(note)}</div>` : ''}
                    </div>
                </article>`;
            }).join('') : '<div class="studio-transcript__empty">Your completed exchanges will be filed here as the rehearsal progresses.</div>';

            // Scroll to bottom
            const chatArea = document.getElementById('chat-area');
            if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;

            // Update question counter
            updateQCounter();
        }

        async function triggerAIResponse(isNudge = false, nudgeText = "") {
            isAITalking = true;
            if (isNudge) { await handleTTS(nudgeText, true); return; }

            aiTurnCount++;
            let curveballActive = false;
            if (!curveballFired && aiTurnCount >= 5 && ['standard', 'extended'].includes(state.duration)) {
                if (Math.random() < 0.25) { curveballFired = true; curveballActive = true; }
            }

            state.chatHistory.push({ role: 'assistant', content: '...', isTyping: true, isCurveball: curveballActive, timestamp: Date.now() });
            updateChatView();
            const typingIndex = state.chatHistory.length - 1;

            let sysPrompt = buildSystemPrompt();
            if (curveballActive) {
                sysPrompt += '\n\n[CURVEBALL] Ask ONE deliberately out-of-depth, expert-level question that would challenge even a seasoned senior professional off-the-cuff. This tests how the candidate handles uncertainty. Do NOT warn them - just ask it naturally as the next question.';
            }

            const messagesToSend = state.chatHistory.filter(m => !m.isTyping && !m.isNudge).map(m => ({ role: m.role, content: m.content }));

            await streamChat(state.selectedModel, messagesToSend, sysPrompt,
                (chunk) => { state.chatHistory[typingIndex].content = chunk; updateChatView(); },
                async (finalText) => {
                    const aiFailed = /^Error connecting to Ollama:/i.test(finalText) || /^Error:\s/i.test(finalText);
                    const displayText = aiFailed
                        ? 'Ollama is open, but qwen2.5:7b is not accepting chat requests. Return to Setup after reloading or reinstalling the model.'
                        : finalText;
                    state.chatHistory[typingIndex].isTyping = false;
                    state.chatHistory[typingIndex].content = displayText;
                    state.chatHistory[typingIndex].isSystemError = aiFailed;
                    state.chatHistory[typingIndex].timestamp = Date.now();
                    updateChatView();
                    if (aiFailed) {
                        sessionBlocked = true;
                        isAITalking = false;
                        interviewerVisual?.setState('idle');
                        const stateLabel = document.getElementById('interviewer-state-label');
                        if (stateLabel) stateLabel.textContent = 'Local AI unavailable';
                        chatInput.disabled = true;
                        chatInput.placeholder = 'Return to Setup and refresh the local model.';
                        sendBtn.disabled = true;
                        document.getElementById('mic-btn').disabled = true;
                        updateLiveCoaching(0);
                        return;
                    }
                    scheduleNextInterruption();
                    await handleTTS(displayText, false);
                }
            );
        }

        // --- TTS with Speaking Visualizer ---
        async function handleTTS(text, isNudge) {
            if (state.voiceMode) {
                try {
                    const res = await fetch('/api/tts', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ text: text, gender: state.interviewerPersona.gender })
                    });
                    const data = await res.json();

                    if (state.currentAudio) Object.assign(state.currentAudio, { onended: null }).pause();
                    state.currentAudio = new Audio(data.audio_url);

                    // Add speaking ring + visualizer when audio starts
                    const onSpeakStart = () => {
                        interviewerVisual?.setState('speaking');
                        const audioActions = document.getElementById('interviewer-audio-actions');
                        if (audioActions) {
                            audioActions.innerHTML = `<div class="ss-visualizer" aria-hidden="true">${Array(7).fill('<div class="ss-viz-bar"></div>').join('')}</div>
                            <button class="ss-skip-btn" id="skip-tts-btn">Skip speech</button>`;
                            document.getElementById('skip-tts-btn')?.addEventListener('click', () => {
                                if (state.currentAudio) state.currentAudio.pause();
                                onSpeakEnd();
                            });
                        }
                    };

                    const onSpeakEnd = () => {
                        interviewerVisual?.setState('idle');
                        // Remove visualizer
                        document.querySelectorAll('.ss-visualizer').forEach(v => v.remove());
                        document.querySelectorAll('.ss-skip-btn').forEach(b => b.remove());
                        if (!isNudge) {
                            isAITalking = false;
                            lastResponseTime = Date.now();
                            lastActivityTime = Date.now();
                        }
                    };

                    state.currentAudio.onplay = onSpeakStart;
                    state.currentAudio.onended = onSpeakEnd;
                    await state.currentAudio.play().catch(e => {
                        console.error('Play error', e);
                        onSpeakEnd();
                    });
                } catch (e) {
                    console.error('TTS error', e);
                    interviewerVisual?.setState('idle');
                    if (!isNudge) {
                        isAITalking = false;
                        lastResponseTime = Date.now();
                        lastActivityTime = Date.now();
                    }
                }
            } else {
                interviewerVisual?.setState('idle');
                if (!isNudge) {
                    isAITalking = false;
                    lastResponseTime = Date.now();
                    lastActivityTime = Date.now();
                }
            }

            if (isNudge) {
                isAITalking = false;
                nudgeSent = true;
            } else {
                nudgeSent = false;
                fetch('/api/sessions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        id: state.currentSessionId,
                        date: new Date().toISOString(),
                        target_role: state.targetRole,
                        module: state.selectedModule,
                        duration_seconds: Math.floor((Date.now() - sessionStartTime) / 1000),
                        messages: state.chatHistory
                    })
                }).finally(() => state.sessionHistoryCache = null);
            }
        }

        // --- Jargon Warning Toast (styled) ---
        function showJargonToast(term) {
            const existing = document.getElementById('jargon-toast');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.id = 'jargon-toast';
            toast.style.cssText = 'position:fixed;bottom:100px;right:20px;z-index:60;max-width:300px;width:100%;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:14px;padding:14px 16px;display:flex;align-items:flex-start;gap:10px;transform:translateY(8px);opacity:0;transition:all .3s;font-family:Inter,sans-serif;box-shadow:0 8px 32px rgba(0,0,0,.3)';
            toast.innerHTML = `<span style="font-size:18px;flex-shrink:0">${ti('bulb')}</span><div style="flex:1"><div style="font-size:13px;font-weight:700;color:#fbbf24;margin-bottom:3px">Jargon Detected</div><div style="font-size:12px;color:var(--t-muted);line-height:1.5">You used <strong style="color:#fbbf24">"${term}"</strong> - consider simplifying.</div></div><button onclick="document.getElementById('jargon-toast')?.remove()" style="background:none;border:none;color:var(--t-muted);cursor:pointer;font-size:14px;flex-shrink:0" aria-label="Dismiss">${ti('x')}</button>`;
            document.body.appendChild(toast);
            requestAnimationFrame(() => requestAnimationFrame(() => { toast.style.transform = 'translateY(0)'; toast.style.opacity = '1'; }));
            setTimeout(() => { if (toast.parentNode) { toast.style.transform = 'translateY(8px)'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); } }, 4000);
        }

        // --- Handle Send ---
        const handleSend = () => {
            if (sessionBlocked) return;
            const text = chatInput.value.trim();
            if (!text) return;

            // Track average response time
            const responseTime = (Date.now() - lastResponseTime) / 1000;
            userResponseTimes.push(responseTime);
            const avgResp = Math.round(userResponseTimes.reduce((a, b) => a + b, 0) / userResponseTimes.length);
            if (avgRespDisplay) avgRespDisplay.textContent = `${avgResp} sec`;

            if (JARGON_FLAGGED_MODULES.includes(state.selectedModule)) {
                const lower = text.toLowerCase();
                const found = JARGON_TERMS.find(term => lower.includes(term));
                if (found) showJargonToast(found);
            }

            chatInput.value = '';
            liveWcEl.textContent = '';
            state.chatHistory.push({ role: 'user', content: text, timestamp: Date.now() });
            updateChatView();
            lastResponseTime = Date.now();
            triggerAIResponse();
        };

        sendBtn.addEventListener('click', handleSend);
        chatInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } });
        micBtn.addEventListener('click', () => { lastActivityTime = Date.now(); });

        // --- End Session Button -> Modal ---
        document.getElementById('end-session-btn').addEventListener('click', () => {
            // Show styled confirmation modal
            const overlay = document.createElement('div');
            overlay.className = 'ss-modal-overlay';
            overlay.id = 'end-session-modal';
            overlay.innerHTML = `
                <div class="ss-modal">
                    <div class="ss-modal-ico">🎤</div>
                    <h3>End this session?</h3>
                    <p>Your interview will be evaluated by the AI coach and you'll receive a detailed performance report.</p>
                    <div class="ss-modal-btns">
                        <button class="ss-modal-cancel" id="modal-cancel">Continue Interview</button>
                        <button class="ss-modal-confirm" id="modal-confirm">End & Get Report</button>
                    </div>
                </div>`;
            document.body.appendChild(overlay);
            document.getElementById('modal-cancel').onclick = () => overlay.remove();
            document.getElementById('modal-confirm').onclick = () => { overlay.remove(); window._doEndSession(); };
            overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
        });

        triggerAIResponse(); // kick off the interview
    }

    window._doEndSession = async function () {
        // Stop body language analysis and collect report
        let presenceData = null;
        if (window.BodyLanguageAnalyzer && window.BodyLanguageAnalyzer.isActive()) {
            presenceData = window.BodyLanguageAnalyzer.getPresenceReport();
            window.BodyLanguageAnalyzer.stop();
            hidePresenceHUD();
        }

        // Build engagement metrics from session data
        const engagementData = buildEngagementMetrics();

        stopCamera();
        document.getElementById('char-avatar')?.setAttribute('data-state', 'thinking');
        const interviewerStateLabel = document.getElementById('interviewer-state-label');
        if (interviewerStateLabel) interviewerStateLabel.textContent = 'Reviewing the rehearsal';
        const btn = document.getElementById('end-session-btn');
        if (btn) { btn.disabled = true; btn.innerHTML = `${ti('loader-2')} Evaluating...`; }

        const chatInput = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send');
        const micBtn = document.getElementById('mic-btn');
        if (chatInput) chatInput.disabled = true;
        if (sendBtn) sendBtn.disabled = true;
        if (micBtn) micBtn.disabled = true;

        if (window.sessionInterval) clearInterval(window.sessionInterval);

        try {
            const res = await fetch('/api/evaluate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    model: state.selectedModel,
                    target_role: state.targetRole || 'General Candidate',
                    module: state.selectedModule || 'general',
                    job_description: state.jobDescription || '',
                    messages: state.chatHistory.filter(m => !m.isTyping),
                    presence_data: presenceData,
                    engagement_data: engagementData,
                    camera_on: state.cameraEnabled && presenceData !== null
                })
            });
            const data = await res.json();
            const feedback = data.feedback;
            state.lastSessionFeedback = feedback;

            if (state.currentAudio) state.currentAudio.pause();

            const sessionTimerEl = document.getElementById('session-timer');
            let duration = 0;
            if (sessionTimerEl) {
                const parts = sessionTimerEl.textContent.split(':');
                duration = parseInt(parts[0]) * 60 + parseInt(parts[1]);
            }

            await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: state.currentSessionId, date: new Date().toISOString(),
                    target_role: state.targetRole, module: state.selectedModule,
                    duration_seconds: duration, messages: state.chatHistory, feedback: feedback
                })
            });
            state.sessionHistoryCache = null;

            try {
                const prevEarned = new Set(JSON.parse(localStorage.getItem('ai_coach_badges') || '[]'));
                const nowEarned = await computeBadges();
                const newlyEarned = [...nowEarned].filter(id => !prevEarned.has(id));
                localStorage.setItem('ai_coach_badges', JSON.stringify([...nowEarned]));
                if (newlyEarned.length > 0) setTimeout(() => showBadgeNotifications(newlyEarned), 800);
            } catch (e) { }

            window.nav('report');
        } catch (e) {
            console.error("Evaluation error:", e);
            alert("Evaluation could not be generated. Start Ollama, confirm qwen2.5:7b is installed, then try again.");
            if (btn) { btn.disabled = false; btn.innerHTML = `${ti('player-stop')} End Session`; }
            if (chatInput) chatInput.disabled = false;
            if (sendBtn) sendBtn.disabled = false;
            if (micBtn) micBtn.disabled = false;
        }
    };

    // Legacy alias
    window.endSession = window._doEndSession;


    function renderReport() {
        const feedback = state.lastSessionFeedback;
        if (!feedback) {
            mainContent.innerHTML = `<div class="min-h-screen flex items-center justify-center" style="color:var(--t-muted)">No feedback available. <button onclick="window.nav('setup')" style="margin-left:16px;text-decoration:underline;color:var(--t-fg);cursor:pointer;background:none;border:none;font:inherit">Go to Setup</button></div>`;
            return;
        }

        const gradeOf = (s) => {
            if (s >= 95) return { g: 'S', c: '#FFD700', desc: 'Exceptional' };
            if (s >= 85) return { g: 'A', c: '#4ade80', desc: 'Excellent' };
            if (s >= 70) return { g: 'B', c: '#60a5fa', desc: 'Good' };
            if (s >= 55) return { g: 'C', c: '#fbbf24', desc: 'Average' };
            if (s >= 40) return { g: 'D', c: '#f97316', desc: 'Below Average' };
            return { g: 'F', c: '#ef4444', desc: 'Needs Work' };
        };
        const metricColor = (v) => v >= 80 ? '#4ade80' : v >= 65 ? '#facc15' : '#f87171';

        const score = feedback.overall_score || 0;
        const grade = gradeOf(score);
        const userResponses = state.chatHistory.filter(m => m.role === 'user').length;
        const moduleTitle = window._getModuleTitle ? window._getModuleTitle(state.selectedModule) : 'Interview';

        const MOD_COLORS = {
            general: '#84cc16', roleplay: '#c084fc', visual: '#60a5fa',
            technical: '#22d3ee', casestudy: '#a78bfa', salary: '#34d399'
        };
        const modColor = MOD_COLORS[state.selectedModule] || '#84cc16';

        // Support both new (pillars) and legacy (scores) format
        const pillars = feedback.pillars || {};
        const interviewScores = pillars.interview?.scores || feedback.interview_scores || feedback.scores || {};
        const moduleScores = pillars.interview?.module_scores || feedback.module_scores || {};
        const presenceMetrics = pillars.presence?.metrics || feedback.presence_data || null;
        const engagementMetrics = pillars.engagement?.metrics || feedback.engagement_data || null;
        const gradeInfo = feedback.grade || null;
        const competencyScores = pillars.interview?.competency_scores || feedback.competency_scores || {};
        const readiness = feedback.readiness || null;
        const riskFlags = feedback.risk_flags || [];
        const practicePlan = feedback.practice_plan || [];
        const questionEvaluations = feedback.question_evaluations || [];
        const transcriptFeatures = feedback.transcript_features || {};
        const evaluatorConfidence = feedback.evaluator_confidence;

        const evalLabel = (key) => ({
            answer_relevance: 'Answer Relevance',
            specificity: 'Specificity',
            structure: 'Structure',
            evidence_quality: 'Evidence Quality',
            impact_orientation: 'Impact Orientation',
            role_alignment: 'Role Alignment',
            communication_clarity: 'Communication Clarity',
            adaptability: 'Adaptability',
            not_ready: 'Not Ready',
            developing: 'Developing',
            near_ready: 'Near Ready',
            interview_ready: 'Interview Ready',
            strong_no: 'Strong No',
            no: 'No',
            lean_no: 'Lean No',
            lean_yes: 'Lean Yes',
            yes: 'Yes',
            strong_yes: 'Strong Yes'
        }[key] || String(key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

        const resp = interviewScores.responsiveness || 0;
        const depth = interviewScores.depth || 0;
        const clarity = interviewScores.clarity || 0;
        const commStyle = interviewScores.communication_style || interviewScores.presence || 0;

        // Radar polygon points (4-axis: top=resp, right=depth, bottom=clarity, left=commStyle)
        const R = 75;
        const radarPts = `100,${100 - R * resp / 100} ${100 + R * depth / 100},100 100,${100 + R * clarity / 100} ${100 - R * commStyle / 100},100`;

        // Average words per answer
        const avgWords = userResponses > 0 ? Math.round(
            state.chatHistory.filter(m => m.role === 'user').reduce((a, m) => a + (m.content || '').split(' ').length, 0) / userResponses
        ) : 0;

        const metrics = [
            { name: 'Responsiveness', val: resp },
            { name: 'Depth of Response', val: depth },
            { name: 'Communication Clarity', val: clarity },
            { name: 'Communication Style', val: commStyle }
        ];

        // Add module-specific metrics
        const moduleMetricNames = {
            empathy: 'Empathy & EQ', conflict_resolution: 'Conflict Resolution', active_listening: 'Active Listening',
            verbal_clarity: 'Verbal Clarity', spatial_reasoning: 'Spatial Reasoning', design_justification: 'Design Justification',
            problem_solving: 'Problem Solving', technical_accuracy: 'Technical Accuracy', thought_process: 'Thought Process',
            framework_usage: 'Framework Usage', quantitative_reasoning: 'Quantitative Reasoning', recommendation_quality: 'Recommendation Quality',
            anchoring_strategy: 'Anchoring Strategy', justification_quality: 'Justification Quality', composure: 'Composure'
        };
        const extraMetrics = Object.entries(moduleScores).map(([key, val]) => ({
            name: moduleMetricNames[key] || key.replace(/_/g, ' '), val: val || 0
        }));

        // Build presence section HTML
        let presenceHTML = '';
        if (presenceMetrics && presenceMetrics.composite > 0) {
            const pm = presenceMetrics;
            presenceHTML = `
            <div class="rpt-coach-card" style="margin-top:20px">
                <div class="rpt-coach-header">
                    <div class="rpt-coach-avatar" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">${ti('video')}</div>
                    <div>
                        <div class="rpt-coach-label">Professional Presence</div>
                        <div class="rpt-coach-sub">Body language analysis from your webcam</div>
                    </div>
                    <div style="margin-left:auto;font-size:24px;font-weight:900;color:${metricColor(pm.composite)}">${pm.composite}</div>
                </div>
                ${[
                    { name: `${ti('eye')} Eye Contact`, val: pm.eye_contact || 0 },
                    { name: `${ti('mood-smile')} Expression`, val: pm.expression || 0 },
                    { name: `${ti('run')} Posture`, val: pm.posture || 0 },
                    { name: `${ti('hand-finger')} Gestures`, val: pm.gestures || 0 },
                    { name: `${ti('refresh')} Head Movement`, val: pm.head_movement || 0 },
                ].map(m => `
                <div class="rpt-metric-row">
                    <div class="rpt-metric-top">
                        <span class="rpt-metric-name">${m.name}</span>
                        <span class="rpt-metric-num" style="color:${metricColor(m.val)}">${m.val}</span>
                    </div>
                    <div class="rpt-metric-bg"><div class="rpt-metric-fill" data-width="${m.val}%" style="width:0%;background:${metricColor(m.val)}"></div></div>
                </div>`).join('')}
            </div>`;
        }

        // Build engagement section HTML
        let engagementHTML = '';
        if (engagementMetrics && engagementMetrics.composite > 0) {
            const em = engagementMetrics;
            engagementHTML = `
            <div class="rpt-coach-card" style="margin-top:20px">
                <div class="rpt-coach-header">
                    <div class="rpt-coach-avatar" style="background:linear-gradient(135deg,#0ea5e9,#06b6d4)">${ti('chart-line')}</div>
                    <div>
                        <div class="rpt-coach-label">Session Engagement</div>
                        <div class="rpt-coach-sub">Response timing & consistency analytics</div>
                    </div>
                    <div style="margin-left:auto;font-size:24px;font-weight:900;color:${metricColor(em.composite)}">${em.composite}</div>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
                    <div class="rpt-stat-item"><div class="rpt-stat-val">${em.avg_response_time_seconds || 0}s</div><div class="rpt-stat-lbl">Avg Response Time</div></div>
                    <div class="rpt-stat-item"><div class="rpt-stat-val">${em.avg_word_count || 0}</div><div class="rpt-stat-lbl">Avg Word Count</div></div>
                </div>
                ${[
                    { name: `${ti('clock')} Response Time`, val: em.response_time || 0 },
                    { name: `${ti('text-size')} Response Length`, val: em.response_length || 0 },
                    { name: `${ti('chart-bar')} Consistency`, val: em.consistency || 0 },
                    { name: `${ti('trending-up')} Trajectory`, val: em.trajectory || 0 },
                ].map(m => `
                <div class="rpt-metric-row" style="margin-top:8px">
                    <div class="rpt-metric-top">
                        <span class="rpt-metric-name">${m.name}</span>
                        <span class="rpt-metric-num" style="color:${metricColor(m.val)}">${m.val}</span>
                    </div>
                    <div class="rpt-metric-bg"><div class="rpt-metric-fill" data-width="${m.val}%" style="width:0%;background:${metricColor(m.val)}"></div></div>
                </div>`).join('')}
            </div>`;
        }

        let readinessHTML = '';
        if (readiness && (readiness.summary || readiness.level || readiness.hire_signal)) {
            const blockers = readiness.blockers || [];
            const signals = readiness.strongest_signals || [];
            readinessHTML = `
            <div class="rpt-coach-card" style="margin-top:20px">
                <div class="rpt-section-title">${ti('target-arrow')} Job Readiness</div>
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">
                    <div class="rpt-stat-item"><div class="rpt-stat-val">${escapeHTML(evalLabel(readiness.level || 'developing'))}</div><div class="rpt-stat-lbl">Readiness</div></div>
                    <div class="rpt-stat-item"><div class="rpt-stat-val">${escapeHTML(evalLabel(readiness.hire_signal || 'lean_no'))}</div><div class="rpt-stat-lbl">Hire Signal</div></div>
                    <div class="rpt-stat-item"><div class="rpt-stat-val">${Number.isFinite(evaluatorConfidence) ? evaluatorConfidence : '-'}</div><div class="rpt-stat-lbl">Confidence</div></div>
                </div>
                ${readiness.summary ? `<div class="rpt-coach-summary">${escapeHTML(readiness.summary)}</div>` : ''}
                ${signals.length ? `<div style="font-size:12px;color:var(--t-muted);line-height:1.7;margin-bottom:8px"><strong style="color:#4ade80">Strongest signals:</strong> ${signals.map(escapeHTML).join('; ')}</div>` : ''}
                ${blockers.length ? `<div style="font-size:12px;color:var(--t-muted);line-height:1.7"><strong style="color:#fbbf24">Blockers:</strong> ${blockers.map(escapeHTML).join('; ')}</div>` : ''}
                ${transcriptFeatures.answer_count !== undefined ? `<div style="margin-top:12px;font-size:11px;color:var(--t-muted)">Transcript: ${transcriptFeatures.answer_count || 0} answers, ${transcriptFeatures.missing_answer_count || 0} missing, avg ${transcriptFeatures.avg_word_count || 0} words</div>` : ''}
            </div>`;
        }

        let competencyHTML = '';
        const competencyEntries = Object.entries({
            answer_relevance: competencyScores.answer_relevance,
            specificity: competencyScores.specificity,
            structure: competencyScores.structure,
            evidence_quality: competencyScores.evidence_quality,
            impact_orientation: competencyScores.impact_orientation,
            role_alignment: competencyScores.role_alignment,
            communication_clarity: competencyScores.communication_clarity,
            adaptability: competencyScores.adaptability
        }).filter(([, val]) => typeof val === 'number');
        if (competencyEntries.length) {
            competencyHTML = `
            <div class="rpt-coach-card" style="margin-top:20px">
                <div class="rpt-section-title">${ti('chart-bar')} Competency Scorecard</div>
                ${competencyEntries.map(([key, val]) => `
                <div class="rpt-metric-row" style="margin-top:8px">
                    <div class="rpt-metric-top">
                        <span class="rpt-metric-name">${escapeHTML(evalLabel(key))}</span>
                        <span class="rpt-metric-num" style="color:${metricColor(val)}">${val}</span>
                    </div>
                    <div class="rpt-metric-bg"><div class="rpt-metric-fill" data-width="${val}%" style="width:0%;background:${metricColor(val)}"></div></div>
                </div>`).join('')}
            </div>`;
        }

        // Build question highlights HTML
        const questionHighlights = feedback.question_highlights || [];
        let highlightsHTML = '';
        if (questionEvaluations.length > 0) {
            highlightsHTML = `
            <div class="rpt-coach-card" style="margin-top:20px">
                <div class="rpt-section-title" style="margin-bottom:12px">${ti('stars')} Question Evaluations</div>
                ${questionEvaluations.map(qe => `
                <div style="padding:12px 0;border-bottom:1px solid var(--t-border)">
                    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:5px">
                        <div style="font-size:12px;font-weight:700;color:var(--t-heading)">"${escapeHTML(qe.question || '')}"</div>
                        <div style="font-size:11px;font-weight:800;color:${metricColor(qe.score || 0)}">${qe.score || 0}</div>
                    </div>
                    <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--t-muted);margin-bottom:6px">${escapeHTML(evalLabel(qe.answer_type || 'partial'))}</div>
                    ${qe.answer_summary ? `<div style="font-size:11px;color:var(--t-muted);margin-bottom:4px"><strong style="color:var(--t-fg)">Answer:</strong> ${escapeHTML(qe.answer_summary)}</div>` : ''}
                    ${qe.coaching_note ? `<div style="font-size:11px;color:var(--t-muted);margin-bottom:4px">${escapeHTML(qe.coaching_note)}</div>` : ''}
                    ${(qe.evidence_quotes || []).length ? `<div style="font-size:11px;color:var(--t-fg);margin:6px 0;padding:8px 10px;border-left:2px solid var(--t-border2);background:var(--t-surface-dim);border-radius:8px"><strong>Evidence:</strong> ${(qe.evidence_quotes || []).map(q => `"${escapeHTML(q)}"`).join(' ')}</div>` : ''}
                    ${qe.missed_opportunity ? `<div style="font-size:11px;color:var(--t-muted);margin-top:6px"><strong style="color:#fbbf24">Missed:</strong> ${escapeHTML(qe.missed_opportunity)}</div>` : ''}
                    ${qe.practice_drill ? `<div style="font-size:11px;color:var(--t-muted);margin-top:4px"><strong style="color:#4ade80">Drill:</strong> ${escapeHTML(qe.practice_drill)}</div>` : ''}
                </div>`).join('')}
            </div>`;
        } else if (questionHighlights.length > 0) {
            highlightsHTML = `
            <div class="rpt-coach-card" style="margin-top:20px">
                <div class="rpt-section-title" style="margin-bottom:12px">${ti('stars')} Question Highlights</div>
                ${questionHighlights.map(qh => `
                <div style="padding:10px 0;border-bottom:1px solid var(--t-border)">
                    <div style="font-size:12px;font-weight:700;color:var(--t-heading);margin-bottom:4px">"${escapeHTML(qh.question || '')}"</div>
                    ${qh.answer_summary ? `<div style="font-size:11px;color:var(--t-muted);margin-bottom:4px"><strong style="color:var(--t-fg)">Answer:</strong> ${escapeHTML(qh.answer_summary)}</div>` : ''}
                    <div style="font-size:11px;color:var(--t-muted);margin-bottom:4px">${escapeHTML(qh.assessment || '')}</div>
                    ${qh.evidence_quote ? `<div style="font-size:11px;color:var(--t-fg);margin:6px 0;padding:8px 10px;border-left:2px solid var(--t-border2);background:var(--t-surface-dim);border-radius:8px"><strong>Evidence:</strong> "${escapeHTML(qh.evidence_quote)}"</div>` : ''}
                    <div style="font-size:11px;font-weight:700;color:${metricColor(qh.score || 0)}">Score: ${qh.score || 0}</div>
                </div>`).join('')}
            </div>`;
        }

        let riskHTML = '';
        if (riskFlags.length > 0) {
            riskHTML = `
            <div class="rpt-flags-card">
                <div class="rpt-section-title" style="color:#f87171">${ti('alert-triangle')} Readiness Risk Flags</div>
                <div class="rpt-flag-list">
                    ${riskFlags.map(flag => `
                    <div class="rpt-flag-item">
                        <div class="rpt-flag-ico">${ti('alert-triangle')}</div>
                        <div class="rpt-flag-text">${escapeHTML(flag)}</div>
                    </div>`).join('')}
                </div>
            </div>`;
        }

        let practicePlanHTML = '';
        if (practicePlan.length > 0) {
            practicePlanHTML = `
            <div class="rpt-next-card">
                <div class="rpt-section-title">${ti('clipboard-list')} Practice Plan</div>
                <div class="rpt-step-list">
                    ${practicePlan.map(step => `
                    <div class="rpt-step-item">
                        <div class="rpt-step-check">${ti('target-arrow')}</div>
                        <div class="rpt-step-text">${escapeHTML(step)}</div>
                    </div>`).join('')}
                </div>
            </div>`;
        }

        const reportCSS = `
        <style>
        .rpt-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
        .rpt-orbs .orb{position:absolute;border-radius:50%;filter:blur(100px)}
        .rpt-orbs .orb1{width:600px;height:600px;background:hsla(38,92%,50%,.07);top:-200px;left:-150px;animation:orb-d1 20s ease-in-out infinite}
        .rpt-orbs .orb2{width:500px;height:500px;background:hsla(270,80%,65%,.08);bottom:-120px;right:-100px;animation:orb-d2 24s ease-in-out infinite}
        .rpt-grade-orb{width:400px;height:400px;position:absolute;top:-60px;left:50%;transform:translateX(-50%);border-radius:50%;filter:blur(100px);opacity:.35;animation:rpt-pulse 3s ease-in-out infinite}
        @keyframes rpt-pulse{0%,100%{opacity:.25}50%{opacity:.45}}
        .rpt-page{position:relative;z-index:1;max-width:720px;margin:0 auto;padding:40px 24px 80px;color:var(--t-fg)}
        .rpt-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:36px}
        .rpt-back{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;transition:color .2s;padding:0;font-family:inherit}
        .rpt-back:hover{color:var(--t-fg)}
        .rpt-export{padding:8px 16px;border-radius:9px;border:1px solid var(--t-border2);background:transparent;color:var(--t-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
        .rpt-export:hover{background:var(--t-surface-hover);color:var(--t-fg)}
        .rpt-hero-header{text-align:center;margin-bottom:40px}
        .rpt-module-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:5px 14px;border-radius:99px;border:1px solid;margin-bottom:14px}
        .rpt-session-complete{font-size:clamp(2rem,4vw,2.8rem);font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:6px}
        .rpt-session-meta{font-size:14px;color:var(--t-muted)}
        .rpt-score-section{display:flex;align-items:center;gap:36px;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:22px;padding:32px;margin-bottom:24px;position:relative;overflow:hidden;flex-wrap:wrap}
        .rpt-score-ring-wrap{position:relative;width:160px;height:160px;flex-shrink:0}
        .rpt-score-ring-wrap svg{position:absolute;inset:0;transform:rotate(-90deg)}
        .rpt-score-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .rpt-score-grade{font-size:52px;font-weight:900;line-height:1}
        .rpt-score-pct{font-size:13px;font-weight:700;color:var(--t-muted);margin-top:4px}
        .rpt-score-desc{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin-top:3px}
        .rpt-score-info{flex:1;min-width:200px}
        .rpt-score-title{font-size:20px;font-weight:800;color:var(--t-heading);margin-bottom:6px}
        .rpt-score-sub{font-size:13px;color:var(--t-muted);margin-bottom:18px;line-height:1.6}
        .rpt-stat-strip{display:flex;gap:16px;flex-wrap:wrap}
        .rpt-stat-item{display:flex;flex-direction:column;gap:2px}
        .rpt-stat-val{font-size:18px;font-weight:800;color:var(--t-heading)}
        .rpt-stat-lbl{font-size:10px;font-weight:600;color:var(--t-muted);text-transform:uppercase;letter-spacing:.05em}
        .rpt-analysis-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
        @media(max-width:640px){.rpt-analysis-grid{grid-template-columns:1fr}}
        .rpt-radar-card{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:18px;padding:22px;display:flex;flex-direction:column;align-items:center}
        .rpt-radar-title{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:16px;align-self:flex-start}
        .rpt-metrics-card{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:18px;padding:22px;display:flex;flex-direction:column;gap:14px}
        .rpt-metrics-title{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted)}
        .rpt-metric-row{display:flex;flex-direction:column;gap:5px}
        .rpt-metric-top{display:flex;justify-content:space-between;align-items:center}
        .rpt-metric-name{font-size:12px;font-weight:600;color:var(--t-fg)}
        .rpt-metric-num{font-size:12px;font-weight:700}
        .rpt-metric-bg{height:5px;background:var(--t-border);border-radius:99px;overflow:hidden}
        .rpt-metric-fill{height:100%;border-radius:99px;transition:width 1.2s cubic-bezier(.4,0,.2,1)}
        .rpt-coach-card{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:18px;padding:24px;margin-bottom:20px;position:relative;overflow:hidden}
        .rpt-coach-header{display:flex;align-items:center;gap:12px;margin-bottom:14px}
        .rpt-coach-avatar{width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#4f46e5);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
        .rpt-coach-label{font-size:13px;font-weight:700;color:var(--t-heading)}
        .rpt-coach-sub{font-size:11px;color:var(--t-muted)}
        .rpt-coach-summary{font-size:14px;color:var(--t-fg);line-height:1.7;margin-bottom:14px}
        .rpt-coach-tip{display:flex;gap:10px;background:rgba(245,158,11,.05);border:1px solid rgba(245,158,11,.2);border-radius:10px;padding:12px 14px}
        .rpt-coach-tip-ico{font-size:16px;flex-shrink:0;margin-top:1px}
        .rpt-coach-tip-text{font-size:13px;color:var(--t-fg);line-height:1.6}
        .rpt-coach-tip-text strong{color:#fbbf24}
        .rpt-improve-card{background:rgba(245,158,11,.04);border:1px solid rgba(245,158,11,.2);border-radius:18px;padding:24px;margin-bottom:20px;position:relative;overflow:hidden}
        .rpt-improve-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:linear-gradient(180deg,#f59e0b,#fbbf24);border-radius:3px 0 0 3px}
        .rpt-improve-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
        .rpt-improve-title{font-size:15px;font-weight:800;color:#fbbf24}
        .rpt-improve-tag{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(245,158,11,.6);padding:3px 10px;border-radius:99px;border:1px solid rgba(245,158,11,.2)}
        .rpt-improve-text{font-size:13px;color:var(--t-fg);line-height:1.7;margin-bottom:14px}
        .rpt-improve-link{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:700;color:#f59e0b;cursor:pointer;background:none;border:none;transition:opacity .2s;font-family:inherit;padding:0}
        .rpt-improve-link:hover{opacity:.75}
        .rpt-next-card{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:18px;padding:24px;margin-bottom:20px}
        .rpt-section-title{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:14px;display:flex;align-items:center;gap:8px}
        .rpt-step-list{display:flex;flex-direction:column;gap:10px}
        .rpt-step-item{display:flex;align-items:flex-start;gap:12px}
        .rpt-step-check{width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(74,222,128,.4);background:rgba(74,222,128,.06);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px;font-size:11px;color:#4ade80}
        .rpt-step-text{font-size:13px;color:var(--t-fg);line-height:1.6;font-weight:500}
        .rpt-flags-card{background:rgba(239,68,68,.04);border:1px solid rgba(239,68,68,.2);border-radius:18px;padding:24px;margin-bottom:20px}
        .rpt-flag-list{display:flex;flex-direction:column;gap:10px}
        .rpt-flag-item{display:flex;align-items:flex-start;gap:12px}
        .rpt-flag-ico{font-size:14px;flex-shrink:0;margin-top:1px}
        .rpt-flag-text{font-size:13px;color:var(--t-fg);line-height:1.6}
        .rpt-divider{height:1px;background:var(--t-border);margin:28px 0}
        .rpt-cta-section{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:32px}
        .rpt-cta-primary{grid-column:1/-1;padding:14px 28px;border-radius:12px;background:linear-gradient(135deg,#b89531,#d4aa3f);color:#000;font-size:14px;font-weight:800;border:none;cursor:pointer;box-shadow:0 4px 20px -4px rgba(184,149,49,.4);transition:all .25s;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-family:inherit}
        .rpt-cta-primary:hover{transform:translateY(-2px);box-shadow:0 8px 28px -4px rgba(184,149,49,.5)}
        .rpt-cta-secondary{padding:13px;border-radius:12px;background:var(--t-surface);border:1px solid var(--t-border2);color:var(--t-fg);font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;justify-content:center;gap:7px;font-family:inherit}
        .rpt-cta-secondary:hover{background:var(--t-border);border-color:var(--t-border2)}
        </style>`;

        mainContent.innerHTML = reportCSS + `
        <div class="rpt-wrap" style="position:relative;min-height:100vh;background:var(--t-bg-solid);overflow-x:hidden">
        <div class="rpt-orbs">
            <div class="orb orb1"></div>
            <div class="orb orb2"></div>
            <div class="rpt-grade-orb" style="background:${grade.c}"></div>
        </div>
        ${starsHTML('rpt-stars')}

        <div class="rpt-page">

            <!-- Top bar -->
            <div class="rpt-top">
                <button class="rpt-back" onclick="window.nav('hero')">${ti('arrow-left')} Back to Home</button>
                <button class="rpt-export">${ti('file-download')} Export PDF</button>
            </div>

            <!-- Header -->
            <div class="rpt-hero-header">
                <div class="rpt-module-pill" style="color:${modColor};border-color:${modColor}40;background:${modColor}12">${ti('chart-bar')} ${moduleTitle}</div>
                <div class="rpt-session-complete">Session Complete</div>
                <div class="rpt-session-meta">${escapeHTML(state.targetRole || 'General Role')} - ${userResponses} responses</div>
            </div>

            <!-- Score ring + quick stats -->
            <div class="rpt-score-section">
                <div class="rpt-score-ring-wrap">
                    <svg viewBox="0 0 160 160">
                        <circle cx="80" cy="80" r="68" fill="none" stroke="var(--t-border)" stroke-width="10"/>
                        <circle cx="80" cy="80" r="68" fill="none" id="rpt-score-ring" stroke="${grade.c}" stroke-width="10"
                            stroke-linecap="round"
                            stroke-dasharray="${2 * Math.PI * 68}" stroke-dashoffset="${2 * Math.PI * 68}"
                            style="filter:drop-shadow(0 0 8px ${grade.c}80);transition:stroke-dashoffset 1.4s cubic-bezier(.4,0,.2,1)"/>
                    </svg>
                    <div class="rpt-score-center">
                        <div class="rpt-score-grade" style="color:${grade.c}">${grade.g}</div>
                        <div class="rpt-score-pct">${score}%</div>
                        <div class="rpt-score-desc" style="color:${grade.c}">${grade.desc}</div>
                    </div>
                </div>
                <div class="rpt-score-info">
                    <div class="rpt-score-title">${escapeHTML(state.targetRole || 'Interview Session')}</div>
                    <div class="rpt-score-sub">${escapeHTML(feedback.coaching_summary || 'Review your performance metrics and improvement areas below.')}</div>
                    <div class="rpt-stat-strip">
                        <div class="rpt-stat-item"><div class="rpt-stat-val">${userResponses}</div><div class="rpt-stat-lbl">Responses</div></div>
                        <div class="rpt-stat-item"><div class="rpt-stat-val">${avgWords}</div><div class="rpt-stat-lbl">Avg Words</div></div>
                    </div>
                </div>
            </div>

            <!-- Radar chart + metric bars -->
            <div class="rpt-analysis-grid">
                <!-- Radar -->
                <div class="rpt-radar-card">
                    <div class="rpt-radar-title">Performance Radar</div>
                    <svg viewBox="0 0 200 200" width="170" height="170">
                        <circle cx="100" cy="100" r="25" fill="none" stroke="var(--t-bar-track)" stroke-width="1"/>
                        <circle cx="100" cy="100" r="50" fill="none" stroke="var(--t-bar-track)" stroke-width="1"/>
                        <circle cx="100" cy="100" r="75" fill="none" stroke="var(--t-border)" stroke-width="1"/>
                        <line x1="100" y1="25" x2="100" y2="175" stroke="var(--t-bar-track)" stroke-width="1"/>
                        <line x1="25" y1="100" x2="175" y2="100" stroke="var(--t-bar-track)" stroke-width="1"/>
                        <text x="100" y="18" text-anchor="middle" font-size="9" fill="var(--t-muted)" font-family="Inter,sans-serif" font-weight="700">RESP</text>
                        <text x="186" y="104" text-anchor="start" font-size="9" fill="var(--t-muted)" font-family="Inter,sans-serif" font-weight="700">DEPTH</text>
                        <text x="100" y="192" text-anchor="middle" font-size="9" fill="var(--t-muted)" font-family="Inter,sans-serif" font-weight="700">CLARITY</text>
                        <text x="14" y="104" text-anchor="end" font-size="9" fill="var(--t-muted)" font-family="Inter,sans-serif" font-weight="700">STYLE</text>
                        <polygon points="${radarPts}"
                            fill="${grade.c}30" stroke="${grade.c}" stroke-width="1.5" stroke-linejoin="round"/>
                        <circle cx="100" cy="${100 - R * resp / 100}" r="3.5" fill="${grade.c}"/>
                        <circle cx="${100 + R * depth / 100}" cy="100" r="3.5" fill="${grade.c}"/>
                        <circle cx="100" cy="${100 + R * clarity / 100}" r="3.5" fill="${grade.c}"/>
                        <circle cx="${100 - R * commStyle / 100}" cy="100" r="3.5" fill="${grade.c}"/>
                    </svg>
                </div>

                <!-- Metric bars -->
                <div class="rpt-metrics-card">
                    <div class="rpt-metrics-title">Sub-Metrics</div>
                    ${metrics.map(m => `
                    <div class="rpt-metric-row">
                        <div class="rpt-metric-top">
                            <span class="rpt-metric-name">${m.name}</span>
                            <span class="rpt-metric-num" style="color:${metricColor(m.val)}">${m.val}</span>
                        </div>
                        <div class="rpt-metric-bg"><div class="rpt-metric-fill" data-width="${m.val}%" style="width:0%;background:${metricColor(m.val)}"></div></div>
                    </div>`).join('')}
                    ${extraMetrics.length > 0 ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--t-border)">
                    <div style="font-size:10px;font-weight:700;color:var(--t-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.06em">Module: ${moduleTitle}</div>
                    ${extraMetrics.map(m => `
                    <div class="rpt-metric-row">
                        <div class="rpt-metric-top">
                            <span class="rpt-metric-name">${m.name}</span>
                            <span class="rpt-metric-num" style="color:${metricColor(m.val)}">${m.val}</span>
                        </div>
                        <div class="rpt-metric-bg"><div class="rpt-metric-fill" data-width="${m.val}%" style="width:0%;background:${metricColor(m.val)}"></div></div>
                    </div>`).join('')}
                    </div>` : ''}
                </div>
            </div>

            ${readinessHTML}
            ${competencyHTML}
            ${presenceHTML}
            ${engagementHTML}
            ${highlightsHTML}
            ${riskHTML}
            ${practicePlanHTML}

            <!-- AI Coach Notes -->
            <div class="rpt-coach-card">
                <div class="rpt-coach-header">
                    <div class="rpt-coach-avatar">${ti('brain')}</div>
                    <div>
                        <div class="rpt-coach-label">AI Coach Notes</div>
                        <div class="rpt-coach-sub">Personalized feedback from your session</div>
                    </div>
                </div>
                <div class="rpt-coach-summary">${escapeHTML(feedback.coaching_summary || 'Complete more sessions to receive detailed coaching feedback.')}</div>
                <div class="rpt-coach-tip">
                    <div class="rpt-coach-tip-ico">${ti('bulb')}</div>
                    <div class="rpt-coach-tip-text"><strong>Key Tip:</strong> ${escapeHTML(feedback.improvement_tip || 'Keep practicing to build confidence and refine your answers.')}</div>
                </div>
            </div>

            <!-- Improvement Focus -->
            ${feedback.weakest_area ? `
            <div class="rpt-improve-card">
                <div class="rpt-improve-header">
                    <div class="rpt-improve-title">${escapeHTML(feedback.weakest_area)}</div>
                    <div class="rpt-improve-tag">Needs Focus</div>
                </div>
                <div class="rpt-improve-text">${escapeHTML(feedback.improvement_tip || 'Focus on this area in your next practice session.')}</div>
                <button class="rpt-improve-link" onclick="window.nav('questions')">${ti('book-2')} Practice targeted questions ${ti('arrow-right')}</button>
            </div>` : ''}

            <!-- Next Steps -->
            <div class="rpt-next-card">
                <div class="rpt-section-title">${ti('circle-check')} Actionable Next Steps</div>
                <div class="rpt-step-list">
                    ${(feedback.actionable_next_steps || ['Continue regular practice sessions', 'Review your core projects', 'Refine your elevator pitch']).map(step => `
                    <div class="rpt-step-item">
                        <div class="rpt-step-check">${ti('check')}</div>
                        <div class="rpt-step-text">${escapeHTML(step)}</div>
                    </div>`).join('')}
                </div>
            </div>

            <!-- Red Flags -->
            ${feedback.red_flags && feedback.red_flags.length > 0 && riskFlags.length === 0 ? `
            <div class="rpt-flags-card">
                <div class="rpt-section-title" style="color:#f87171">${ti('alert-triangle')} Red Flag Radar</div>
                <div class="rpt-flag-list">
                    ${feedback.red_flags.map(flag => `
                    <div class="rpt-flag-item">
                        <div class="rpt-flag-ico">${ti('alert-triangle')}</div>
                        <div class="rpt-flag-text">${escapeHTML(flag)}</div>
                    </div>`).join('')}
                </div>
            </div>` : ''}

            <div class="rpt-divider"></div>

            <!-- CTA -->
            <div class="rpt-cta-section">
                <button class="rpt-cta-primary" onclick="window.nav('setup')">${ti('refresh')} Practice Again</button>
                <button class="rpt-cta-secondary" onclick="window.nav('history')">${ti('history')} Session History</button>
                <button class="rpt-cta-secondary" onclick="window.nav('hero')">${ti('home')} Back to Home</button>
            </div>

        </div>

        </div>
        `;

        // Init stars background
        initStarsBg('rpt-stars');

        // Animate metric bars after render
        setTimeout(() => {
            const ring = document.getElementById('rpt-score-ring');
            if (ring) {
                const circ = 2 * Math.PI * 68;
                ring.style.strokeDashoffset = circ * (1 - score / 100);
            }
            document.querySelectorAll('.rpt-metric-fill').forEach(el => {
                el.style.width = el.getAttribute('data-width');
            });
        }, 200);
    }

    // --- History Page (concept design) ---
    async function renderHistory(filter = 'all') {
        if (!mainContent.innerHTML.includes('hist-page')) {
            mainContent.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;min-height:80vh;color:var(--t-muted)"><span style="animation:spin 1s linear infinite;display:inline-block;margin-right:10px">${ti('loader-2')}</span> Loading history...</div>`;
        }

        try {
            if (!state.sessionHistoryCache) {
                const res = await fetch('/api/sessions');
                const data = await res.json();
                state.sessionHistoryCache = data.sessions || [];
            }
            const allSessions = state.sessionHistoryCache;

            const MOD_META = {
                general: { label: 'General', icon: 'layers-intersect', color: '#84cc16', bg: 'rgba(132,204,22,.12)', border: 'rgba(132,204,22,.3)' },
                roleplay: { label: 'Roleplay', icon: 'messages', color: '#c084fc', bg: 'rgba(192,132,252,.12)', border: 'rgba(192,132,252,.3)' },
                visual: { label: 'Visual', icon: 'presentation', color: '#60a5fa', bg: 'rgba(96,165,250,.12)', border: 'rgba(96,165,250,.3)' },
                technical: { label: 'Technical', icon: 'code', color: '#22d3ee', bg: 'rgba(34,211,238,.12)', border: 'rgba(34,211,238,.3)' },
                casestudy: { label: 'Case Study', icon: 'chart-dots-3', color: '#a78bfa', bg: 'rgba(167,139,250,.12)', border: 'rgba(167,139,250,.3)' },
                salary: { label: 'Salary', icon: 'cash', color: '#34d399', bg: 'rgba(52,211,153,.12)', border: 'rgba(52,211,153,.3)' },
                strategy: { label: 'Strategy', icon: 'chart-dots-3', color: '#34d399', bg: 'rgba(52,211,153,.12)', border: 'rgba(52,211,153,.3)' },
            };

            const gradeOf = (s) => {
                if (s >= 90) return { g: 'A', c: '#22c55e' };
                if (s >= 80) return { g: 'B', c: '#3b82f6' };
                if (s >= 70) return { g: 'C', c: '#eab308' };
                if (s >= 60) return { g: 'D', c: '#f97316' };
                if (s > 0) return { g: 'F', c: '#ef4444' };
                return { g: '-', c: '#71717a' };
            };
            const barColor = (v) => v >= 80 ? '#4ade80' : v >= 65 ? '#facc15' : '#f87171';

            const sessions = filter === 'all' ? allSessions : allSessions.filter(s => s.module === filter);
            const validSessions = sessions.filter(s => s.feedback && typeof s.feedback.overall_score === 'number').reverse();
            const totalSessions = sessions.length;

            let avgScore = 0, bestScore = 0, recentTrend = 0;
            if (validSessions.length > 0) {
                avgScore = Math.round(validSessions.reduce((sum, s) => sum + s.feedback.overall_score, 0) / validSessions.length);
                bestScore = Math.max(...validSessions.map(s => s.feedback.overall_score));
                if (validSessions.length >= 2) {
                    recentTrend = validSessions[validSessions.length - 1].feedback.overall_score - validSessions[validSessions.length - 2].feedback.overall_score;
                }
            }
            const tc = recentTrend > 0 ? 'up' : recentTrend < 0 ? 'down' : 'flat';
            const ts = recentTrend > 0 ? '+' : '';

            const clearHistory = async () => {
                if (confirm('Are you sure you want to clear all history? This cannot be undone.')) {
                    try {
                        await fetch('/api/sessions', { method: 'DELETE' });
                        state.sessionHistoryCache = null;
                        renderHistory('all');
                    } catch (e) { alert('Error clearing history.'); }
                }
            };
            window.clearHistory = clearHistory;
            window.filterHistory = renderHistory;

            const chipClass = (f, val) => f === val
                ? 'hist-chip hist-chip-on'
                : 'hist-chip';

            const histCSS = `
            <style>
            .hist-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
            .hist-orbs .orb{position:absolute;border-radius:50%;filter:blur(90px);will-change:transform}
            .hist-orbs .o1{width:700px;height:700px;background:hsla(38,92%,50%,.07);top:-200px;left:-200px;animation:orb-d1 18s ease-in-out infinite}
            .hist-orbs .o2{width:500px;height:500px;background:hsla(270,80%,65%,.08);bottom:-120px;right:-120px;animation:orb-d2 22s ease-in-out infinite}
            .hist-orbs .o3{width:380px;height:380px;background:hsla(190,92%,60%,.10);top:35%;left:58%;animation:orb-d3 26s ease-in-out infinite}
            @keyframes orb-d3{0%,100%{transform:translate(-50%,-50%)}50%{transform:translate(-50%,-50%) translate(50px,-60px)}}
            .hist-page{position:relative;z-index:1;max-width:1100px;margin:0 auto;padding:48px 40px 80px;color:var(--t-fg)}
            .hist-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:48px}
            .hist-back{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;transition:color .2s;padding:0;font-family:inherit}
            .hist-back:hover{color:var(--t-fg)}
            .hist-clear{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;color:var(--t-muted);background:none;border:1px solid var(--t-border);border-radius:8px;padding:7px 14px;cursor:pointer;transition:all .2s;font-family:inherit}
            .hist-clear:hover{color:#f87171;border-color:rgba(248,113,113,.3)}
            .hist-title{font-size:clamp(2rem,4vw,3rem);font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:6px}
            .hist-sub{font-size:15px;color:var(--t-muted)}
            .hist-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:36px 0}
            @media(max-width:640px){.hist-stats{grid-template-columns:repeat(2,1fr)}}
            .hist-stat{background:var(--t-surface);border:1px solid var(--t-border);border-radius:16px;padding:22px 20px;display:flex;flex-direction:column;gap:4px;transition:border-color .25s}
            .hist-stat:hover{border-color:var(--t-border2)}
            .hist-stat-ico{font-size:20px;margin-bottom:8px}
            .hist-stat-val{font-size:2rem;font-weight:800;letter-spacing:-.03em;color:var(--t-heading)}
            .hist-stat-val.up{color:#4ade80}.hist-stat-val.down{color:#f87171}.hist-stat-val.flat{color:#facc15}
            .hist-stat-lbl{font-size:12px;color:var(--t-muted);font-weight:500}
            .hist-chart{background:var(--t-surface);border:1px solid var(--t-border);border-radius:18px;padding:28px 32px 20px;margin-bottom:32px}
            .hist-chart-hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
            .hist-chart-title{font-size:14px;font-weight:700;color:var(--t-fg)}
            .hist-chart-leg{display:flex;gap:16px}
            .hist-leg{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--t-muted)}
            .hist-leg-dot{width:8px;height:8px;border-radius:50%}
            canvas.hist-canvas{width:100%;height:160px;display:block}
            .hist-filter{display:flex;align-items:center;gap:8px;margin-bottom:20px;flex-wrap:wrap}
            .hist-flbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t-muted);margin-right:4px}
            .hist-chip{padding:6px 14px;border-radius:99px;font-size:12px;font-weight:600;border:1px solid var(--t-border);background:transparent;color:var(--t-muted);cursor:pointer;transition:all .2s;font-family:inherit}
            .hist-chip:hover{border-color:var(--t-border2);color:var(--t-fg)}
            .hist-chip-on{background:hsla(38,92%,50%,.12);border-color:hsla(38,92%,50%,.4);color:var(--c-amber)}
            .hist-list{display:flex;flex-direction:column;gap:12px}
            .hist-sess{background:var(--t-surface);border:1px solid var(--t-border);border-radius:16px;padding:20px 24px;display:flex;align-items:center;gap:20px;cursor:pointer;transition:all .25s;position:relative;overflow:hidden}
            .hist-sess::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;border-radius:3px 0 0 3px;transition:opacity .25s}
            .hist-sess:hover{border-color:var(--t-border2);background:var(--t-surface-hover);transform:translateX(2px)}
            .hist-grade{position:relative;width:56px;height:56px;flex-shrink:0;margin-left:6px}
            .hist-grade svg{position:absolute;inset:0;transform:rotate(-90deg)}
            .hist-grade-lbl{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:900}
            .hist-grade-sub{position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-size:10px;font-weight:600;color:var(--t-muted);white-space:nowrap}
            .hist-info{flex:1;min-width:0}
            .hist-role{font-size:15px;font-weight:700;color:var(--t-fg);margin-bottom:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
            .hist-mod{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;letter-spacing:.05em;padding:2px 8px;border-radius:5px;border:1px solid}
            .hist-meta{font-size:12px;color:var(--t-muted);display:flex;align-items:center;gap:8px;margin-bottom:10px}
            .hist-dot{width:3px;height:3px;border-radius:50%;background:var(--t-border2);display:inline-block}
            .hist-bars{display:flex;gap:12px;flex-wrap:wrap}
            .hist-bar-w{display:flex;flex-direction:column;gap:4px;min-width:70px}
            .hist-bar-l{font-size:10px;color:var(--t-muted);font-weight:500}
            .hist-bar-bg{height:4px;background:var(--t-bar-track);border-radius:99px;overflow:hidden}
            .hist-bar-f{height:100%;border-radius:99px;transition:width .6s ease}
            .hist-right{display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex-shrink:0}
            .hist-date{font-size:11px;color:var(--t-muted)}
            .hist-review{opacity:0;transform:translateX(6px);transition:all .2s;padding:6px 12px;border-radius:8px;background:hsla(38,92%,50%,.1);border:1px solid hsla(38,92%,50%,.3);color:var(--c-amber);font-size:11px;font-weight:600;cursor:pointer;font-family:inherit}
            .hist-sess:hover .hist-review{opacity:1;transform:translateX(0)}
            .hist-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:80px 40px;text-align:center;border:1px solid var(--t-border);border-radius:18px;background:var(--t-surface)}
            .hist-empty-ico{font-size:48px;margin-bottom:16px;opacity:.4}
            .hist-empty h3{font-size:20px;font-weight:700;margin-bottom:8px;color:var(--t-fg)}
            .hist-empty p{color:var(--t-muted);margin-bottom:24px}
            .hist-empty-actions{display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap}
            .hist-empty-btn{display:inline-flex;align-items:center;gap:7px;padding:12px 22px;border-radius:10px;background:var(--c-amber);color:#000;font-weight:700;font-size:14px;border:none;cursor:pointer;font-family:inherit}
            .hist-empty-btn.secondary{background:transparent;color:var(--t-fg);border:1px solid var(--t-border)}
            </style>`;

            // Build session cards HTML
            let sessionsHtml = '';
            if (sessions.length === 0 && allSessions.length === 0) {
                sessionsHtml = `<div class="hist-empty"><div class="hist-empty-ico">${ti('inbox')}</div><h3>No sessions yet</h3><p>Complete your first mock interview or load the sample V3 report.</p><div class="hist-empty-actions"><button class="hist-empty-btn" onclick="window.nav('setup')">${ti('rocket')} Start Practicing</button><button class="hist-empty-btn secondary" onclick="window.loadDemoReport()">${ti('chart-bar')} Demo Report</button></div></div>`;
            } else if (sessions.length === 0) {
                sessionsHtml = `<div class="hist-empty"><div class="hist-empty-ico">${ti('search')}</div><h3>No sessions found</h3><p>No sessions match this filter.</p></div>`;
            } else {
                sessionsHtml = sessions.map((s, idx) => {
                    const score = s.feedback?.overall_score || 0;
                    const g = gradeOf(score);
                    const mm = MOD_META[s.module] || MOD_META.general;
                    const circ = 2 * Math.PI * 22;
                    const off = circ * (1 - score / 100);
                    const dateStr = new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
                    const dur = s.duration_seconds > 0 ? Math.round(s.duration_seconds / 60) + ' min' : '< 1 min';
                    const histScores = s.feedback?.pillars?.interview?.scores || s.feedback?.interview_scores || s.feedback?.scores || {};
                    const resp = histScores.responsiveness || 0;
                    const depth = histScores.depth || 0;
                    const clarity = histScores.clarity || 0;
                    let userRespCount = 0;
                    if (s.messages && Array.isArray(s.messages)) {
                        userRespCount = s.messages.filter(m => m.role === 'user').length;
                    }

                    return `
                    <div class="hist-sess" style="--acc:${mm.color}" onclick="window.renderSessionReview(window._historySessionsRef[${sessions.indexOf(s)}])">
                        <style>.hist-sess:nth-child(${idx + 1})::before{background:${mm.color};opacity:.7}</style>
                        <div class="hist-grade">
                            <svg viewBox="0 0 56 56">
                                <circle cx="28" cy="28" r="22" fill="none" stroke="var(--t-border)" stroke-width="4"/>
                                <circle cx="28" cy="28" r="22" fill="none" stroke="${g.c}" stroke-width="4"
                                    stroke-dasharray="${circ}" stroke-dashoffset="${off}"
                                    stroke-linecap="round" style="filter:drop-shadow(0 0 5px ${g.c}60)"/>
                            </svg>
                            <div class="hist-grade-lbl" style="color:${g.c}">${g.g}</div>
                            <div class="hist-grade-sub">${score}%</div>
                        </div>
                        <div class="hist-info">
                            <div class="hist-role">
                                ${s.target_role || 'General Role'}
                                <span class="hist-mod" style="color:${mm.color};background:${mm.bg};border-color:${mm.border}">${ti(mm.icon || 'circle')} ${mm.label}</span>
                            </div>
                            <div class="hist-meta">
                                <span>${dateStr}</span><span class="hist-dot"></span>
                                <span>${dur}</span><span class="hist-dot"></span>
                                <span>${userRespCount} responses</span>
                            </div>
                            <div class="hist-bars">
                                ${[['Resp', resp], ['Depth', depth], ['Clarity', clarity]].map(([l, v]) => `
                                <div class="hist-bar-w">
                                    <div class="hist-bar-l">${l} <span style="color:var(--t-heading);font-weight:700">${v}</span></div>
                                    <div class="hist-bar-bg"><div class="hist-bar-f" style="width:${v}%;background:${barColor(v)}"></div></div>
                                </div>`).join('')}
                            </div>
                        </div>
                        <div class="hist-right">
                            <button class="hist-review">Review ${ti('arrow-right')}</button>
                        </div>
                    </div>`;
                }).join('');
            }

            mainContent.innerHTML = histCSS + `
            <div class="hist-wrap" style="position:relative;min-height:100vh;background:var(--t-bg-solid);overflow-x:hidden">
            <div class="hist-orbs"><div class="orb o1"></div><div class="orb o2"></div><div class="orb o3"></div></div>

            <div class="hist-page">
                <div class="hist-top">
                    <button class="hist-back" onclick="window.nav('hero')">${ti('arrow-left')} Back to Home</button>
                    ${allSessions.length > 0 ? `<button class="hist-clear" onclick="window.clearHistory()">${ti('trash')} Clear History</button>` : ''}
                </div>

                <div class="hist-title">Session History</div>
                <div class="hist-sub">Track your interview preparation progress over time.</div>

                ${allSessions.length > 0 ? `
                <!-- Stats -->
                <div class="hist-stats">
                    <div class="hist-stat"><div class="hist-stat-ico">${ti('calendar')}</div><div class="hist-stat-val">${totalSessions}</div><div class="hist-stat-lbl">Total Sessions</div></div>
                    <div class="hist-stat"><div class="hist-stat-ico">${ti('chart-bar')}</div><div class="hist-stat-val">${avgScore}%</div><div class="hist-stat-lbl">Average Score</div></div>
                    <div class="hist-stat"><div class="hist-stat-ico">${ti('trophy')}</div><div class="hist-stat-val">${bestScore}%</div><div class="hist-stat-lbl">Best Score</div></div>
                    <div class="hist-stat"><div class="hist-stat-ico">${ti('trending-up')}</div><div class="hist-stat-val ${tc}">${ts}${recentTrend}%</div><div class="hist-stat-lbl">Recent Trend</div></div>
                </div>

                <!-- Chart -->
                ${validSessions.length >= 2 ? `
                <div class="hist-chart">
                    <div class="hist-chart-hd">
                        <span class="hist-chart-title">Score Trend</span>
                        <div class="hist-chart-leg">
                            <div class="hist-leg"><div class="hist-leg-dot" style="background:#f59e0b"></div>Overall score</div>
                            <div class="hist-leg"><div class="hist-leg-dot" style="background:#60a5fa;opacity:.6"></div>Avg</div>
                        </div>
                    </div>
                    <canvas class="hist-canvas" id="histChart"></canvas>
                </div>` : ''}

                <!-- Filters -->
                <div class="hist-filter">
                    <span class="hist-flbl">Filter:</span>
                    <button class="${chipClass(filter, 'all')}" onclick="window.filterHistory('all')">All Modules</button>
                    <button class="${chipClass(filter, 'general')}" onclick="window.filterHistory('general')">${ti('layers-intersect')} General</button>
                    <button class="${chipClass(filter, 'roleplay')}" onclick="window.filterHistory('roleplay')">${ti('messages')} Roleplay</button>
                    <button class="${chipClass(filter, 'visual')}" onclick="window.filterHistory('visual')">${ti('presentation')} Visual</button>
                    <button class="${chipClass(filter, 'technical')}" onclick="window.filterHistory('technical')">${ti('code')} Technical</button>
                    <button class="${chipClass(filter, 'casestudy')}" onclick="window.filterHistory('casestudy')">${ti('chart-dots-3')} Case Study</button>
                    <button class="${chipClass(filter, 'salary')}" onclick="window.filterHistory('salary')">${ti('cash')} Salary</button>
                </div>
                ` : ''}

                <!-- Session list -->
                <div class="hist-list">${sessionsHtml}</div>
            </div>
            </div>`;

            window._historySessionsRef = sessions;

            // Draw canvas chart
            if (validSessions.length >= 2) {
                requestAnimationFrame(() => requestAnimationFrame(() => {
                    const canvas = document.getElementById('histChart');
                    if (!canvas) return;
                    const dpr = window.devicePixelRatio || 1;
                    const W = canvas.offsetWidth, H = 160;
                    canvas.width = W * dpr;
                    canvas.height = H * dpr;
                    canvas.style.width = W + 'px';
                    canvas.style.height = H + 'px';
                    const ctx = canvas.getContext('2d');
                    ctx.scale(dpr, dpr);

                    const data = validSessions; // already oldest-first
                    const pad = { t: 10, r: 20, b: 30, l: 40 };
                    const iW = W - pad.l - pad.r;
                    const iH = H - pad.t - pad.b;
                    const avg = Math.round(data.reduce((a, b) => a + b.feedback.overall_score, 0) / data.length);

                    // Grid
                    ctx.strokeStyle = 'var(--t-bar-track)';
                    ctx.lineWidth = 1;
                    [0, 25, 50, 75, 100].forEach(v => {
                        const y = pad.t + iH - (v / 100) * iH;
                        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + iW, y); ctx.stroke();
                        ctx.fillStyle = 'var(--t-border2)';
                        ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'right';
                        ctx.fillText(v, pad.l - 6, y + 3.5);
                    });

                    // Avg dashed
                    const avgY = pad.t + iH - (avg / 100) * iH;
                    ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(96,165,250,.4)'; ctx.lineWidth = 1;
                    ctx.beginPath(); ctx.moveTo(pad.l, avgY); ctx.lineTo(pad.l + iW, avgY); ctx.stroke();
                    ctx.setLineDash([]);

                    // Points
                    const pts = data.map((s, i) => ({
                        x: pad.l + (i / (data.length - 1)) * iW,
                        y: pad.t + iH - (s.feedback.overall_score / 100) * iH,
                        score: s.feedback.overall_score,
                        date: new Date(s.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    }));

                    // Gradient fill
                    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + iH);
                    grad.addColorStop(0, 'rgba(245,158,11,.25)');
                    grad.addColorStop(1, 'rgba(245,158,11,0)');
                    ctx.beginPath();
                    pts.forEach((p, i) => {
                        if (i === 0) ctx.moveTo(p.x, p.y);
                        else {
                            const cp = pts[i - 1].x + (p.x - pts[i - 1].x) / 2;
                            ctx.bezierCurveTo(cp, pts[i - 1].y, cp, p.y, p.x, p.y);
                        }
                    });
                    ctx.lineTo(pts[pts.length - 1].x, pad.t + iH);
                    ctx.lineTo(pts[0].x, pad.t + iH);
                    ctx.fillStyle = grad; ctx.fill();

                    // Line
                    ctx.beginPath();
                    pts.forEach((p, i) => {
                        if (i === 0) ctx.moveTo(p.x, p.y);
                        else {
                            const cp = pts[i - 1].x + (p.x - pts[i - 1].x) / 2;
                            ctx.bezierCurveTo(cp, pts[i - 1].y, cp, p.y, p.x, p.y);
                        }
                    });
                    ctx.strokeStyle = '#f59e0b'; ctx.lineWidth = 2.5; ctx.stroke();

                    // Dots
                    pts.forEach(p => {
                        ctx.beginPath(); ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
                        ctx.fillStyle = '#f59e0b'; ctx.shadowColor = '#f59e0b'; ctx.shadowBlur = 8;
                        ctx.fill(); ctx.shadowBlur = 0;
                        ctx.beginPath(); ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
                    });

                    // X labels
                    ctx.fillStyle = 'rgba(255,255,255,.3)'; ctx.font = '10px Inter,sans-serif'; ctx.textAlign = 'center';
                    ctx.fillText(pts[0].date, pts[0].x, pad.t + iH + 18);
                    ctx.fillText(pts[pts.length - 1].date, pts[pts.length - 1].x, pad.t + iH + 18);
                    if (pts.length > 4) {
                        const mid = Math.floor(pts.length / 2);
                        ctx.fillText(pts[mid].date, pts[mid].x, pad.t + iH + 18);
                    }
                }));
            }

        } catch (e) {
            console.error("History error:", e);
            mainContent.innerHTML = '<div style="padding:40px;text-align:center;color:#f87171">Error loading history. Make sure the server is running.</div>';
        }
    }

    // --- Session Review Page (concept design) ---
    window.renderSessionReview = function (session) {
        if (!session) return;
        const messages = session.messages || [];
        const feedback = session.feedback || {};
        const score = feedback.overall_score || 0;
        const role = session.target_role || 'General Role';
        const mod = session.module || 'general';
        const dateStr = new Date(session.date).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
        const durationMin = session.duration_seconds ? Math.round(session.duration_seconds / 60) : 0;

        const gradeOf = (s) => {
            if (s >= 90) return { g: 'A', c: '#22c55e', label: 'Excellent' };
            if (s >= 80) return { g: 'B', c: '#3b82f6', label: 'Good' };
            if (s >= 70) return { g: 'C', c: '#eab308', label: 'Fair' };
            if (s >= 60) return { g: 'D', c: '#f97316', label: 'Needs Work' };
            if (s > 0) return { g: 'F', c: '#ef4444', label: 'Incomplete' };
            return { g: '-', c: '#71717a', label: 'No Score' };
        };
        const g = gradeOf(score);
        const metricColor = (v) => v >= 80 ? '#4ade80' : v >= 65 ? '#facc15' : '#f87171';
        const wcColor = (wc) => wc >= 60 ? '#4ade80' : wc >= 20 ? '#facc15' : '#f87171';

        // Build Q&A pairs
        const pairs = [];
        const cleanMsgs = messages.filter(m => !m.isHidden && !m.isNudge);
        for (let i = 0; i < cleanMsgs.length; i++) {
            if (cleanMsgs[i].role === 'assistant' && cleanMsgs[i + 1]?.role === 'user') {
                pairs.push({ q: cleanMsgs[i].content, a: cleanMsgs[i + 1].content, isCurveball: !!cleanMsgs[i].isCurveball });
            }
        }

        const curveballCount = pairs.filter(p => p.isCurveball).length;
        const wordsPerAnswer = pairs.length ? Math.round(pairs.reduce((s, p) => s + p.a.split(' ').length, 0) / pairs.length) : 0;

        const MOD_META = {
            general: { label: 'General', color: '#84cc16' },
            roleplay: { label: 'Roleplay', color: '#c084fc' },
            visual: { label: 'Visual', color: '#60a5fa' },
            technical: { label: 'Technical', color: '#22d3ee' },
            casestudy: { label: 'Case Study', color: '#a78bfa' },
            salary: { label: 'Salary', color: '#34d399' },
        };
        const mm = MOD_META[mod] || MOD_META.general;

        const srPillars = feedback.pillars || {};
        const srInterviewScores = srPillars.interview?.scores || feedback.interview_scores || feedback.scores || {};
        const srReadiness = feedback.readiness || null;
        const srRiskFlags = feedback.risk_flags || [];
        const srPracticePlan = feedback.practice_plan || [];
        const resp = srInterviewScores.responsiveness || 0;
        const depth = srInterviewScores.depth || 0;
        const clarity = srInterviewScores.clarity || 0;
        const presence = srPillars.presence?.score || feedback.scores?.presence || 0;
        const metricsArr = [
            ['Responsiveness', resp], ['Depth of Response', depth],
            ['Communication Clarity', clarity], ['Professional Presence', presence]
        ];
        const srEvalLabel = (key) => ({
            not_ready: 'Not Ready',
            developing: 'Developing',
            near_ready: 'Near Ready',
            interview_ready: 'Interview Ready',
            strong_no: 'Strong No',
            no: 'No',
            lean_no: 'Lean No',
            lean_yes: 'Lean Yes',
            yes: 'Yes',
            strong_yes: 'Strong Yes'
        }[key] || String(key || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

        const circ = 2 * Math.PI * 42;

        mainContent.innerHTML = `
            <style>

                .sr-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);font-family:'Plus Jakarta Sans','Inter',sans-serif;color:var(--t-fg)}
                .sr-wrap::-webkit-scrollbar{width:5px}.sr-wrap::-webkit-scrollbar-track{background:transparent}.sr-wrap::-webkit-scrollbar-thumb{background:var(--t-border);border-radius:99px}

                /* ORBS */
                .sr-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
                .sr-orbs .orb{position:absolute;border-radius:50%;filter:blur(90px)}
                .sr-orbs .o1{width:600px;height:600px;background:hsla(38,92%,50%,.07);top:-180px;left:-180px;animation:sr-d1 18s ease-in-out infinite}
                .sr-orbs .o2{width:450px;height:450px;background:hsla(270,80%,65%,.08);bottom:-100px;right:-100px;animation:sr-d2 22s ease-in-out infinite}
                .sr-orbs .o3{width:340px;height:340px;background:hsla(190,92%,60%,.08);bottom:0;left:20%;animation:sr-d3 26s ease-in-out infinite}
                @keyframes sr-d1{0%,100%{transform:translate(0,0)}50%{transform:translate(70px,50px)}}
                @keyframes sr-d2{0%,100%{transform:translate(0,0)}50%{transform:translate(-70px,-70px)}}
                @keyframes sr-d3{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,-50px)}}

                .sr-page{position:relative;z-index:1;max-width:1140px;margin:0 auto;padding:40px 36px 80px}

                /* TOP BAR */
                .sr-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px}
                .sr-back{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;transition:color .2s;padding:0;font-family:inherit}
                .sr-back:hover{color:var(--t-fg)}
                .sr-export{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--t-muted);background:var(--t-surface);border:1px solid var(--t-border);border-radius:9px;padding:8px 16px;cursor:pointer;transition:all .2s;font-family:inherit}
                .sr-export:hover{border-color:var(--t-border2);color:var(--t-fg)}

                /* HERO CARD */
                .sr-hero{background:var(--t-surface);border:1px solid var(--t-border);border-radius:20px;padding:32px;margin-bottom:28px;position:relative;overflow:hidden}
                .sr-hero-glow{position:absolute;top:-80px;right:-80px;width:200px;height:200px;border-radius:50%;filter:blur(70px);pointer-events:none;opacity:.5}
                .sr-hero-inner{display:flex;align-items:flex-start;gap:28px;flex-wrap:wrap}

                /* Score ring */
                .sr-ring-wrap{position:relative;width:100px;height:100px;flex-shrink:0}
                .sr-ring-wrap svg{position:absolute;inset:0;transform:rotate(-90deg)}
                .sr-ring-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
                .sr-ring-grade{font-size:28px;font-weight:900;line-height:1}
                .sr-ring-pct{font-size:11px;font-weight:600;color:var(--t-muted);margin-top:2px}

                .sr-hero-info{flex:1;min-width:200px}
                .sr-badges{display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap}
                .sr-mod-badge{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 10px;border-radius:6px}
                .sr-grade-badge{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:3px 8px;border-radius:6px}
                .sr-hero-role{font-size:1.7rem;font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:6px}
                .sr-hero-meta{font-size:12px;color:var(--t-muted)}

                .sr-retry{display:inline-flex;align-items:center;gap:7px;padding:11px 20px;border-radius:10px;background:hsl(38,92%,50%);color:#000;font-size:13px;font-weight:700;border:none;cursor:pointer;box-shadow:0 4px 20px -4px hsla(38,92%,50%,.4);transition:all .25s;white-space:nowrap;font-family:inherit;align-self:flex-start}
                .sr-retry:hover{transform:translateY(-1px);box-shadow:0 8px 28px -4px hsla(38,92%,50%,.5)}

                /* Stats strip */
                .sr-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:0;border-top:1px solid var(--t-border);margin-top:24px;padding-top:20px}
                .sr-stat{text-align:center}
                .sr-stat + .sr-stat{border-left:1px solid var(--t-border)}
                .sr-stat-val{font-size:1.4rem;font-weight:800;margin-bottom:4px}
                .sr-stat-lbl{font-size:11px;color:var(--t-muted)}

                /* TWO COLUMN */
                .sr-cols{display:grid;grid-template-columns:1fr 320px;gap:24px;align-items:start}
                @media(max-width:900px){.sr-cols{grid-template-columns:1fr}}

                /* TRANSCRIPT (left) */
                .sr-section-title{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--t-muted);margin-bottom:16px}
                .sr-timeline{position:relative}
                .sr-spine{position:absolute;left:19px;top:36px;bottom:36px;width:1px;background:var(--t-border)}
                .sr-qa-list{display:flex;flex-direction:column;gap:16px}

                .sr-qa-item{position:relative;padding-left:52px}
                .sr-qa-num{position:absolute;left:0;top:6px;width:38px;height:38px;border-radius:50%;border:1.5px solid var(--t-border2);background:#111;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:var(--t-muted);z-index:1}
                .sr-qa-num.curveball{border-color:rgba(250,180,60,.5);color:#facc15;background:rgba(250,180,60,.06)}

                .sr-qa-card{background:var(--t-surface);border:1px solid var(--t-border);border-radius:14px;overflow:hidden;transition:border-color .25s}
                .sr-qa-card:hover{border-color:var(--t-border2)}
                .sr-qa-card.curveball-card{border-left:3px solid rgba(250,180,60,.6)}

                .sr-q-pane{padding:16px 18px;border-bottom:1px solid var(--t-border)}
                .sr-q-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
                .sr-q-icon{width:26px;height:26px;border-radius:7px;background:hsla(38,92%,50%,.1);border:1px solid hsla(38,92%,50%,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px}
                .sr-q-label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:hsl(38,92%,50%)}
                .sr-curveball-pill{font-size:10px;font-weight:700;padding:2px 8px;border-radius:5px;background:rgba(250,180,60,.1);border:1px solid rgba(250,180,60,.3);color:#facc15}
                .sr-q-text{font-size:14px;color:var(--t-fg);line-height:1.65;padding-left:34px}

                .sr-a-pane{padding:16px 18px;background:rgba(0,0,0,.12)}
                .sr-a-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
                .sr-a-icon{width:26px;height:26px;border-radius:7px;background:var(--t-surface-hover);border:1px solid var(--t-border);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:13px}
                .sr-a-label{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t-muted)}
                .sr-a-text{font-size:14px;color:var(--t-fg);line-height:1.65;padding-left:34px;margin-bottom:12px}

                .sr-wc-row{display:flex;align-items:center;justify-content:space-between;padding-left:34px}
                .sr-wc-bar-wrap{flex:1;max-width:180px}
                .sr-wc-bar-bg{height:3px;background:var(--t-border);border-radius:99px;overflow:hidden}
                .sr-wc-bar-fill{height:100%;border-radius:99px}
                .sr-wc-label{font-size:10px;font-weight:600;margin-top:3px}
                .sr-ideal-btn{font-size:11px;font-weight:700;color:#60a5fa;background:none;border:none;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:color .2s;font-family:inherit;padding:0}
                .sr-ideal-btn:hover{color:#93c5fd}
                .sr-ideal-box{display:none;margin-top:12px;margin-left:34px;padding:14px 16px;border-radius:10px;background:rgba(96,165,250,.06);border:1px solid rgba(96,165,250,.2);animation:sr-fadeSlide .3s ease}
                .sr-ideal-box.open{display:block}
                .sr-ideal-tag{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#60a5fa;margin-bottom:7px}
                .sr-ideal-text{font-size:13px;color:var(--t-fg);line-height:1.65}
                @keyframes sr-fadeSlide{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}

                /* SIDEBAR */
                .sr-sidebar{position:sticky;top:24px}
                .sr-sidebar-card{background:var(--t-surface);border:1px solid var(--t-border);border-radius:16px;padding:22px;margin-bottom:16px}
                .sr-scard-title{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--t-muted);margin-bottom:16px;display:flex;align-items:center;gap:7px}

                .sr-sub-metric{margin-bottom:14px}
                .sr-sub-metric:last-child{margin-bottom:0}
                .sr-sm-row{display:flex;justify-content:space-between;align-items:center;margin-bottom:5px}
                .sr-sm-name{font-size:12px;color:var(--t-fg);font-weight:500}
                .sr-sm-val{font-size:12px;font-weight:700}
                .sr-sm-bg{height:5px;background:var(--t-border);border-radius:99px;overflow:hidden}
                .sr-sm-fill{height:100%;border-radius:99px;transition:width 1s ease .3s}

                .sr-feedback-text{font-size:13px;color:var(--t-muted);line-height:1.7;margin-bottom:16px}
                .sr-tip-box{padding:12px 14px;border-radius:10px;background:rgba(250,200,50,.05);border:1px solid rgba(250,200,50,.2)}
                .sr-tip-tag{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:hsl(38,92%,50%);margin-bottom:6px}
                .sr-tip-text{font-size:12px;color:var(--t-fg);line-height:1.6}

                .sr-qa-actions{display:flex;flex-direction:column;gap:8px}
                .sr-act-btn{display:flex;align-items:center;gap:9px;padding:11px 14px;border-radius:10px;border:1px solid var(--t-border);background:transparent;color:var(--t-muted);font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;width:100%;text-align:left;font-family:inherit}
                .sr-act-btn:hover{border-color:var(--t-border2);color:var(--t-fg);background:var(--t-surface)}
                .sr-act-btn .sr-act-icon{font-size:16px}
                .sr-act-btn.primary{background:hsla(38,92%,50%,.1);border-color:hsla(38,92%,50%,.3);color:hsl(38,92%,50%)}
                .sr-act-btn.primary:hover{background:hsla(38,92%,50%,.15);border-color:hsla(38,92%,50%,.5)}

                /* Entrance animation */
                .sr-fade-in{opacity:0;transform:translateY(16px);animation:sr-up .5s ease forwards}
                @keyframes sr-up{to{opacity:1;transform:translateY(0)}}
            </style>

            <div class="sr-wrap">
                <div class="sr-orbs">
                    <div class="orb o1"></div>
                    <div class="orb o2"></div>
                    <div class="orb o3"></div>
                </div>

                <div class="sr-page">
                    <!-- Top bar -->
                    <div class="sr-top sr-fade-in" style="animation-delay:.05s">
                        <button class="sr-back" onclick="window.nav('history')">${ti('arrow-left')} Session History</button>
                        <button class="sr-export" onclick="window._exportSessionPDF()">${ti('file-download')} Export PDF</button>
                    </div>

                    <!-- Hero card -->
                    <div class="sr-hero sr-fade-in" style="animation-delay:.12s">
                        <div class="sr-hero-glow" style="background:${g.c}"></div>
                        <div class="sr-hero-inner">
                            <!-- Score ring -->
                            <div class="sr-ring-wrap">
                                <svg viewBox="0 0 100 100">
                                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--t-border)" stroke-width="8"/>
                                    <circle cx="50" cy="50" r="42" fill="none" id="sr-ring-fill"
                                        stroke="${g.c}" stroke-width="8" stroke-linecap="round"
                                        stroke-dasharray="${circ}" stroke-dashoffset="${circ}"
                                        style="filter:drop-shadow(0 0 6px ${g.c}60);transition:stroke-dashoffset 1.2s cubic-bezier(.4,0,.2,1)"/>
                                </svg>
                                <div class="sr-ring-center">
                                    <div class="sr-ring-grade" style="color:${g.c}">${g.g}</div>
                                    <div class="sr-ring-pct">${score}%</div>
                                </div>
                            </div>

                            <!-- Info -->
                            <div class="sr-hero-info">
                                <div class="sr-badges">
                                    <span class="sr-mod-badge" style="color:${mm.color};background:${mm.color}20;border:1px solid ${mm.color}40">${mm.label}</span>
                                    <span class="sr-grade-badge" style="color:${g.c};background:${g.c}15;border:1px solid ${g.c}30">${g.label}</span>
                                </div>
                                <div class="sr-hero-role">${role}</div>
                                <div class="sr-hero-meta">${dateStr} - ${durationMin} min - ${pairs.length} questions</div>
                            </div>

                            <!-- Retry -->
                            <button class="sr-retry" onclick="state.targetRole='${role.replace(/'/g, "\\'")}';state.selectedModule='${mod}';window.nav('setup');">${ti('refresh')} Retry This Role</button>
                        </div>

                        <!-- Stats strip -->
                        <div class="sr-stats">
                            <div class="sr-stat"><div class="sr-stat-val">${pairs.length}</div><div class="sr-stat-lbl">Questions</div></div>
                            <div class="sr-stat"><div class="sr-stat-val" style="color:${curveballCount > 0 ? '#facc15' : 'var(--t-fg)'}">${curveballCount}</div><div class="sr-stat-lbl">Curveballs</div></div>
                            <div class="sr-stat"><div class="sr-stat-val" style="color:${wcColor(wordsPerAnswer)}">${wordsPerAnswer}</div><div class="sr-stat-lbl">Avg Words / Answer</div></div>
                        </div>
                    </div>

                    <!-- Two-column body -->
                    <div class="sr-cols">
                        <!-- LEFT: Transcript -->
                        <div class="sr-fade-in" style="animation-delay:.2s">
                            <div class="sr-section-title">${ti('file-text')} Session Transcript
                                <span style="font-size:11px;font-weight:400;color:var(--t-muted);text-transform:none;letter-spacing:0;margin-left:auto">Click ${ti('sparkles')} to generate an ideal answer</span>
                            </div>

                            ${pairs.length === 0 ? '<div style="text-align:center;padding:60px 0;color:var(--t-muted);font-size:13px">No Q&A pairs found in this session.</div>' : `
                            <div class="sr-timeline">
                                <div class="sr-spine"></div>
                                <div class="sr-qa-list">
                                    ${pairs.map((p, i) => {
            const wc = p.a.split(' ').length;
            const wcc = wcColor(wc);
            const wcLabel = wc >= 60 ? 'Detailed' : wc >= 20 ? 'Decent' : 'Too brief';
            return `
                                    <div class="sr-qa-item">
                                        <div class="sr-qa-num ${p.isCurveball ? 'curveball' : ''}">${i + 1}</div>
                                        <div class="sr-qa-card ${p.isCurveball ? 'curveball-card' : ''}">
                                            <div class="sr-q-pane">
                                                <div class="sr-q-head">
                                                    <div class="sr-q-icon">${ti('robot')}</div>
                                                    <span class="sr-q-label">Interviewer</span>
                                                    ${p.isCurveball ? `<span class="sr-curveball-pill">${ti('bolt')} Curveball</span>` : ''}
                                                </div>
                                                <div class="sr-q-text">${p.q}</div>
                                            </div>
                                            <div class="sr-a-pane">
                                                <div class="sr-a-head">
                                                    <div class="sr-a-icon">${ti('user')}</div>
                                                    <span class="sr-a-label">Your Answer</span>
                                                </div>
                                                <div class="sr-a-text">${p.a}</div>
                                                <div class="sr-wc-row">
                                                    <div class="sr-wc-bar-wrap">
                                                        <div class="sr-wc-bar-bg"><div class="sr-wc-bar-fill" style="width:${Math.min(wc / 120 * 100, 100)}%;background:${wcc}"></div></div>
                                                        <div class="sr-wc-label" style="color:${wcc}">${wc} words - ${wcLabel}</div>
                                                    </div>
                                                    <button class="sr-ideal-btn" id="sr-ideal-btn-${i}" onclick="window._srToggleIdeal(${i}, \`${p.q.replace(/`/g, '\\`').replace(/\n/g, ' ').substring(0, 300)}\`, '${role.replace(/'/g, "\\'")}', '${mod}')">${ti('sparkles')} Ideal Answer</button>
                                                </div>
                                                <div class="sr-ideal-box" id="sr-ideal-${i}">
                                                    <div class="sr-ideal-tag">${ti('sparkles')} Ideal Answer</div>
                                                    <div class="sr-ideal-text" id="sr-ideal-text-${i}">Generating...</div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>`;
        }).join('')}
                                </div>
                            </div>`}
                        </div>

                        <!-- RIGHT: Sidebar -->
                        <div class="sr-sidebar sr-fade-in" style="animation-delay:.3s">
                            <!-- Performance breakdown -->
                            <div class="sr-sidebar-card">
                                <div class="sr-scard-title">${ti('chart-bar')} Performance Breakdown</div>
                                ${metricsArr.map(([name, val]) => `
                                <div class="sr-sub-metric">
                                    <div class="sr-sm-row">
                                        <span class="sr-sm-name">${name}</span>
                                        <span class="sr-sm-val" style="color:${metricColor(val)}">${val}</span>
                                    </div>
                                    <div class="sr-sm-bg"><div class="sr-sm-fill" data-w="${val}%" style="width:0%;background:${metricColor(val)}"></div></div>
                                </div>`).join('')}
                            </div>

                            ${srReadiness ? `
                            <div class="sr-sidebar-card">
                                <div class="sr-scard-title">${ti('target-arrow')} Job Readiness</div>
                                <div class="sr-sub-metric">
                                    <div class="sr-sm-row"><span class="sr-sm-name">Readiness</span><span class="sr-sm-val">${escapeHTML(srEvalLabel(srReadiness.level || 'developing'))}</span></div>
                                </div>
                                <div class="sr-sub-metric">
                                    <div class="sr-sm-row"><span class="sr-sm-name">Hire Signal</span><span class="sr-sm-val">${escapeHTML(srEvalLabel(srReadiness.hire_signal || 'lean_no'))}</span></div>
                                </div>
                                ${srReadiness.summary ? `<p class="sr-feedback-text">${escapeHTML(srReadiness.summary)}</p>` : ''}
                                ${srRiskFlags.length ? `<div class="sr-tip-box"><div class="sr-tip-tag">${ti('alert-triangle')} Risk Flags</div><div class="sr-tip-text">${srRiskFlags.map(escapeHTML).join('; ')}</div></div>` : ''}
                                ${srPracticePlan.length ? `<div class="sr-tip-box" style="margin-top:10px"><div class="sr-tip-tag">${ti('clipboard-list')} Practice Plan</div><div class="sr-tip-text">${srPracticePlan.map(escapeHTML).join('; ')}</div></div>` : ''}
                            </div>` : ''}

                            <!-- AI Coach Notes -->
                            ${feedback.coaching_summary || feedback.summary || feedback.improvement_tip ? `
                            <div class="sr-sidebar-card">
                                <div class="sr-scard-title">${ti('brain')} AI Coach Notes</div>
                                <p class="sr-feedback-text">${escapeHTML(feedback.coaching_summary || feedback.summary || '')}</p>
                                ${feedback.improvement_tip ? `
                                <div class="sr-tip-box">
                                    <div class="sr-tip-tag">${ti('bulb')} Key Tip</div>
                                    <div class="sr-tip-text">${escapeHTML(feedback.improvement_tip)}</div>
                                </div>` : ''}
                            </div>` : ''}

                            <!-- Quick Actions -->
                            <div class="sr-sidebar-card">
                                <div class="sr-scard-title">${ti('bolt')} Quick Actions</div>
                                <div class="sr-qa-actions">
                                    <button class="sr-act-btn primary" onclick="state.targetRole='${role.replace(/'/g, "\\'")}';state.selectedModule='${mod}';window.nav('setup');"><span class="sr-act-icon">${ti('refresh')}</span> Retry This Role</button>
                                    <button class="sr-act-btn" onclick="window.nav('setup')"><span class="sr-act-icon">${ti('target-arrow')}</span> Start New Session</button>
                                    <button class="sr-act-btn" onclick="window._exportSessionPDF()"><span class="sr-act-icon">${ti('file-download')}</span> Export PDF</button>
                                    <button class="sr-act-btn" onclick="window.nav('history')"><span class="sr-act-icon">${ti('arrow-left')}</span> Back to History</button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Animate score ring fill
        setTimeout(() => {
            const fill = document.getElementById('sr-ring-fill');
            if (fill) fill.setAttribute('stroke-dashoffset', circ * (1 - score / 100));
            // Animate metric bars
            document.querySelectorAll('.sr-sm-fill').forEach(el => { el.style.width = el.getAttribute('data-w'); });
        }, 200);

        // Ideal answer toggle/generate
        window._srToggleIdeal = async (idx, question, role, mod) => {
            const box = document.getElementById('sr-ideal-' + idx);
            const btn = document.getElementById('sr-ideal-btn-' + idx);
            if (!box || !btn) return;
            if (box.classList.contains('open')) {
                box.classList.remove('open');
                btn.innerHTML = `${ti('sparkles')} Ideal Answer`;
                return;
            }
            box.classList.add('open');
            btn.innerHTML = `${ti('x')} Close`;
            const textEl = document.getElementById('sr-ideal-text-' + idx);
            textEl.textContent = 'Generating...';
            try {
                const res = await fetch('/api/ideal-answer', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model: state.selectedModel, question, role, module: mod })
                });
                const data = await res.json();
                textEl.textContent = data.ideal_answer || 'Could not generate.';
            } catch (e) {
                textEl.textContent = 'Failed to generate. Try again.';
            }
        };

        // PDF Export
        window._exportSessionPDF = () => {
            const pairsHtml = pairs.map((pair, i) => `
                <div style="margin-bottom:24px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;page-break-inside:avoid;">
                    <div style="background:#f8fafc;padding:14px 18px;border-bottom:1px solid #e2e8f0;">
                        <span style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;">Question ${i + 1}</span>
                        <p style="margin:6px 0 0;color:#1e293b;font-size:13px;line-height:1.6;">${pair.q}</p>
                    </div>
                    <div style="padding:14px 18px;">
                        <span style="font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;">Your Answer</span>
                        <p style="margin:6px 0 0;color:#334155;font-size:13px;line-height:1.6;">${pair.a}</p>
                    </div>
                </div>`).join('');

            const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Interview Report - ${role}</title>
            <style>*{box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1e293b;margin:0;padding:40px;max-width:800px;margin:0 auto}@media print{body{padding:20px}}</style></head><body>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #e2e8f0;">
                <div>
                    <div style="font-size:11px;font-weight:700;color:#b89531;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;">Interview Report Card</div>
                    <h1 style="margin:0 0 4px;font-size:26px;font-weight:800;color:#0f172a;">${role}</h1>
                    <p style="margin:0;font-size:13px;color:#64748b;">${dateStr} - ${durationMin} min - ${pairs.length} questions</p>
                </div>
                <div style="text-align:center;background:${g.c}15;border:2px solid ${g.c}40;border-radius:12px;padding:12px 20px;">
                    <div style="font-size:32px;font-weight:900;color:${g.c};">${g.g}</div>
                    <div style="font-size:12px;font-weight:700;color:${g.c};">${score > 0 ? score + '%' : 'N/A'}</div>
                </div>
            </div>
            <h2 style="font-size:16px;font-weight:700;color:#0f172a;margin:0 0 16px;">Session Transcript</h2>
            ${pairsHtml}
            <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center;">Generated by Interview Chameleon AI Coach - ${new Date().toLocaleString()}</div>
            </body></html>`;
            const win = window.open('', '_blank', 'width=900,height=700');
            win.document.write(html);
            win.document.close();
            win.onload = () => { win.focus(); win.print(); };
        };
    };

    // --- Portfolio Deep-Dive ---
    function renderPortfolio() {
        let ptfCount = 8;
        let ptfGenerating = false;

        mainContent.innerHTML = `
            <style>
                .ptf-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);font-family:'Inter',system-ui,sans-serif;color:var(--t-fg);overflow-x:hidden}
                .ptf-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
                .ptf-orb{position:absolute;border-radius:50%;filter:blur(100px)}
                .ptf-o1{width:600px;height:600px;background:hsla(270,80%,65%,.09);top:-200px;left:-160px;animation:ptfd1 20s ease-in-out infinite}
                .ptf-o2{width:500px;height:500px;background:hsla(38,92%,50%,.07);bottom:-120px;right:-120px;animation:ptfd2 24s ease-in-out infinite}
                .ptf-o3{width:380px;height:380px;background:hsla(190,92%,60%,.08);bottom:10%;right:20%;animation:ptfd3 28s ease-in-out infinite}
                @keyframes ptfd1{0%,100%{transform:translate(0,0)}50%{transform:translate(70px,50px)}}
                @keyframes ptfd2{0%,100%{transform:translate(0,0)}50%{transform:translate(-70px,-70px)}}
                @keyframes ptfd3{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,-50px)}}
                .ptf-page{position:relative;z-index:1;max-width:760px;margin:0 auto;padding:40px 24px 80px}
                .ptf-back{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;transition:color .2s;padding:0;margin-bottom:36px}
                .ptf-back:hover{color:var(--t-fg)}
                .ptf-hero-ico{width:48px;height:48px;border-radius:14px;background:rgba(139,92,246,.1);border:1px solid rgba(139,92,246,.25);display:flex;align-items:center;justify-content:center;font-size:22px;margin-bottom:14px}
                .ptf-title{font-size:clamp(1.8rem,3vw,2.4rem);font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:8px}
                .ptf-sub{font-size:14px;color:var(--t-muted);line-height:1.65;margin-bottom:16px}
                .ptf-pill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:rgba(245,158,11,.8);background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.2);padding:5px 12px;border-radius:99px;margin-bottom:32px}
                .ptf-card{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:20px;padding:28px;margin-bottom:24px;position:relative;overflow:hidden}
                .ptf-card::before{content:'';position:absolute;top:-60px;right:-60px;width:200px;height:200px;background:rgba(139,92,246,.06);border-radius:50%;filter:blur(50px);pointer-events:none}
                .ptf-flbl{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:8px;display:block}
                .ptf-fw{margin-bottom:20px}
                .ptf-url-row{display:flex;gap:8px}
                .ptf-inp{flex:1;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:10px;padding:11px 14px;font-size:14px;color:var(--t-fg);outline:none;font-family:inherit;transition:border-color .2s,box-shadow .2s}
                .ptf-inp:focus{border-color:rgba(139,92,246,.5);box-shadow:0 0 0 3px rgba(139,92,246,.08)}
                .ptf-inp::placeholder{color:var(--t-muted)}
                .ptf-prev-btn{padding:10px 16px;border-radius:10px;border:1px solid var(--t-border2);background:var(--t-surface-hover);color:var(--t-muted);font-size:13px;font-weight:600;cursor:pointer;white-space:nowrap;transition:all .2s;font-family:inherit}
                .ptf-prev-btn:hover{background:var(--t-border);color:var(--t-fg)}
                .ptf-preview{display:none;margin-top:10px;background:rgba(0,0,0,.3);border:1px solid var(--t-border);border-radius:10px;padding:12px 14px;font-size:12px;color:var(--t-muted);line-height:1.7;max-height:120px;overflow-y:auto;font-family:monospace}
                .ptf-preview.open{display:block}
                .ptf-2col{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}
                .ptf-chips{display:flex;gap:6px;flex-wrap:wrap}
                .ptf-chip{padding:8px 16px;border-radius:9px;border:1px solid var(--t-border2);background:transparent;color:var(--t-muted);font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;font-family:inherit}
                .ptf-chip:hover{border-color:rgba(139,92,246,.4);color:#c4b5fd}
                .ptf-chip.on{background:rgba(139,92,246,.15);border-color:rgba(139,92,246,.5);color:#c4b5fd;box-shadow:0 0 12px -4px rgba(139,92,246,.3)}
                .ptf-gen-wrap{display:flex;justify-content:center;margin-top:4px}
                .ptf-gen-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;transition:all .25s;background:radial-gradient(65% 65% at 50% 100%,rgba(223,113,255,.8) 0%,rgba(223,113,255,0) 100%),linear-gradient(0deg,#7a5af8,#7a5af8);border-radius:.75rem;border:none;outline:none;padding:14px 36px;cursor:pointer}
                .ptf-gen-btn::before{content:'';position:absolute;inset:1px;border-radius:calc(.75rem - 1px);background:linear-gradient(178deg,rgba(255,255,255,.19) 0%,rgba(255,255,255,0) 100%);z-index:0}
                .ptf-gen-btn::after{content:'';position:absolute;inset:2px;border-radius:calc(.75rem - 2px);background:radial-gradient(65% 65% at 50% 100%,rgba(223,113,255,.8) 0%,rgba(223,113,255,0) 100%),linear-gradient(0deg,#7a5af8,#7a5af8);z-index:0}
                .ptf-gen-btn:active{transform:scale(.97)}
                .ptf-gen-inner{z-index:2;position:relative;color:white;display:inline-flex;align-items:center;justify-content:center;gap:8px;font-size:15px;font-weight:600;line-height:1.5;font-family:inherit}
                .ptf-results{margin-top:28px;display:none}
                .ptf-results.show{display:block}
                .ptf-res-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
                .ptf-res-title{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted)}
                .ptf-res-acts{display:flex;gap:8px}
                .ptf-act{padding:6px 14px;border-radius:8px;border:1px solid var(--t-border2);background:transparent;color:var(--t-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
                .ptf-act:hover{background:var(--t-surface-hover);color:var(--t-fg)}
                .ptf-q-list{display:flex;flex-direction:column;gap:10px}
                .ptf-qi{background:var(--t-surface);border:1px solid rgba(139,92,246,.15);border-radius:14px;padding:18px 20px;display:flex;gap:14px;align-items:flex-start;transition:all .25s}
                .ptf-qi:hover{border-color:rgba(139,92,246,.35);background:rgba(139,92,246,.04);transform:translateX(3px)}
                .ptf-qn{flex-shrink:0;width:28px;height:28px;border-radius:50%;background:rgba(139,92,246,.12);border:1px solid rgba(139,92,246,.25);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#a78bfa}
                .ptf-qb{flex:1}
                .ptf-qt{font-size:14px;font-weight:600;color:var(--t-fg);line-height:1.6;margin-bottom:6px}
                .ptf-qnote{font-size:11px;color:var(--t-muted);font-style:italic;line-height:1.5}
                .ptf-qacts{display:flex;gap:6px;margin-top:10px}
                .ptf-qa{padding:4px 11px;border-radius:7px;border:1px solid var(--t-border);background:transparent;color:var(--t-muted);font-size:11px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
                .ptf-qa:hover{background:var(--t-surface-hover);color:var(--t-fg)}
                .ptf-qa.save:hover{border-color:rgba(245,158,11,.4);color:#fbbf24;background:rgba(245,158,11,.06)}
                .ptf-skel{height:72px;border-radius:14px;background:linear-gradient(90deg,var(--t-surface-dim) 25%,var(--t-bar-track) 50%,var(--t-surface-dim) 75%);background-size:200% 100%;animation:ptf-skel-wave 1.5s ease-in-out infinite}
                @keyframes ptf-skel-wave{0%{background-position:200% 0}100%{background-position:-200% 0}}
                @media(max-width:600px){.ptf-2col{grid-template-columns:1fr}}
            </style>

            <div class="ptf-wrap">
                <div class="ptf-orbs"><div class="ptf-orb ptf-o1"></div><div class="ptf-orb ptf-o2"></div><div class="ptf-orb ptf-o3"></div></div>
                ${starsHTML('ptf-stars')}
                <div class="ptf-page">
                    <button class="ptf-back" onclick="window.nav('hero')">${ti('arrow-left')} Back to Home</button>
                    <div class="ptf-hero-ico">${ti('search')}</div>
                    <div class="ptf-title">Portfolio Deep-Dive</div>
                    <div class="ptf-sub">Paste your portfolio, GitHub or LinkedIn URL - the AI reads your work and generates tailored interview questions specific to <em>your</em> projects, skills and experience.</div>
                    <div class="ptf-pill">${ti('world')} Requires internet to fetch URL - Runs locally via Ollama</div>

                    <div class="ptf-card">
                        <div class="ptf-fw">
                            <label class="ptf-flbl">Portfolio / GitHub / LinkedIn URL *</label>
                            <div class="ptf-url-row">
                                <input class="ptf-inp" id="ptf-url" type="url" placeholder="https://yourname.dev  or  github.com/username">
                                <button class="ptf-prev-btn" onclick="document.getElementById('ptf-preview').classList.toggle('open')">Preview</button>
                            </div>
                            <div class="ptf-preview" id="ptf-preview">Fetched content will appear here after generation...</div>
                        </div>
                        <div class="ptf-2col">
                            <div>
                                <label class="ptf-flbl">Target Role *</label>
                                <input class="ptf-inp" id="ptf-role" type="text" placeholder="e.g. Senior Frontend Engineer">
                            </div>
                            <div>
                                <label class="ptf-flbl">Number of Questions</label>
                                <div class="ptf-chips" id="ptf-chips">
                                    <button class="ptf-chip" onclick="window._ptfCount(5,this)">5</button>
                                    <button class="ptf-chip on" onclick="window._ptfCount(8,this)">8</button>
                                    <button class="ptf-chip" onclick="window._ptfCount(10,this)">10</button>
                                    <button class="ptf-chip" onclick="window._ptfCount(15,this)">15</button>
                                    <button class="ptf-chip" onclick="window._ptfCount(20,this)">20</button>
                                </div>
                            </div>
                        </div>
                        <div class="ptf-gen-wrap">
                            <button class="ptf-gen-btn" id="ptf-gen-btn" onclick="window._ptfGenerate()">
                                <span class="ptf-gen-inner">${ti('bolt')} Generate Interview Questions</span>
                            </button>
                        </div>
                    </div>

                    <div class="ptf-results" id="ptf-results">
                        <div class="ptf-res-hdr">
                            <div class="ptf-res-title" id="ptf-res-title"></div>
                            <div class="ptf-res-acts">
                                <button class="ptf-act" onclick="window._ptfGenerate()">${ti('refresh')} Regenerate</button>
                            </div>
                        </div>
                        <div class="ptf-q-list" id="ptf-q-list"></div>
                    </div>
                </div>
            </div>
        `;

        // Init stars background
        initStarsBg('ptf-stars');

        window._ptfCount = (n, btn) => {
            ptfCount = n;
            document.querySelectorAll('.ptf-chip').forEach(b => b.classList.remove('on'));
            btn.classList.add('on');
        };

        window._ptfGenerate = async () => {
            if (ptfGenerating) return;
            ptfGenerating = true;

            const url = document.getElementById('ptf-url')?.value?.trim();
            const role = document.getElementById('ptf-role')?.value?.trim() || 'your target role';
            const model = state.selectedModel || 'qwen2.5:7b';
            const btn = document.getElementById('ptf-gen-btn');
            const results = document.getElementById('ptf-results');
            const list = document.getElementById('ptf-q-list');
            const title = document.getElementById('ptf-res-title');

            if (!url) {
                alert('Please enter a portfolio URL');
                ptfGenerating = false;
                return;
            }

            results.classList.add('show');
            title.textContent = ptfCount + ' questions for ' + role;
            btn.querySelector('.ptf-gen-inner').innerHTML = `${ti('sparkles')} Generating...`;
            btn.disabled = true;

            // Show skeletons
            list.innerHTML = Array.from({ length: ptfCount }).map((_, i) =>
                '<div class="ptf-skel" style="animation-delay:' + i * 0.07 + 's"></div>'
            ).join('');

            let fullText = '';
            try {
                const res = await fetch('/api/portfolio-analysis', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ model, portfolio_url: url, target_role: role, question_count: ptfCount })
                });
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.detail || 'Server error');
                }

                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    fullText += decoder.decode(value, { stream: true });
                    window._ptfRenderQs(fullText);
                }
                window._ptfRenderQs(fullText);
            } catch (e) {
                list.innerHTML = `<div style="padding:20px;background:rgba(240,60,60,.1);border:1px solid rgba(240,60,60,.2);border-radius:14px;color:rgba(255,120,120,.9);font-size:13px">${ti('circle-x')} ${escapeHTML(e.message)}</div>`;
            }

            ptfGenerating = false;
            btn.disabled = false;
            btn.querySelector('.ptf-gen-inner').innerHTML = `${ti('refresh')} Regenerate`;
        };

        window._ptfRenderQs = (text) => {
            const list = document.getElementById('ptf-q-list');
            if (!list) return;
            const blocks = text.split(/\n(?=\d+\.\s)/);
            let html = '';
            blocks.forEach((block, i) => {
                const qMatch = block.match(/^\d+\.\s+([\s\S]+?)(?:\nNOTE:|$)/);
                const noteMatch = block.match(/NOTE:\s*([\s\S]+)/);
                if (!qMatch) return;
                const question = qMatch[1].trim();
                const note = noteMatch ? noteMatch[1].trim() : '';
                html += '<div class="ptf-qi">'
                    + '<div class="ptf-qn">' + (i + 1) + '</div>'
                    + '<div class="ptf-qb">'
                    + '<div class="ptf-qt">' + question + '</div>'
                    + (note ? '<div class="ptf-qnote">' + ti('bulb') + ' ' + note + '</div>' : '')
                    + '<div class="ptf-qacts"><button class="ptf-qa save" onclick="navigator.clipboard.writeText(this.closest(\'.ptf-qi\').querySelector(\'.ptf-qt\').textContent)">' + ti('star') + ' Save to Bank</button><button class="ptf-qa" onclick="navigator.clipboard.writeText(this.closest(\'.ptf-qi\').querySelector(\'.ptf-qt\').textContent)">' + ti('clipboard') + ' Copy</button></div>'
                    + '</div></div>';
            });
            list.innerHTML = html || '<div style="padding:16px;color:var(--t-muted);font-size:13px">Generating questions...</div>';
        };
    }

    function renderQuestions() {
        const MOD_COLOR = {
            'Roleplay': '#c084fc', 'Visual': '#60a5fa',
            'Technical': '#22d3ee', 'General': '#84cc16',
            'Case Study': '#a78bfa', 'Salary': '#34d399'
        };
        const DIFF_COLOR = { 'Easy': '#4ade80', 'Medium': '#facc15', 'Hard': '#f87171' };

        // Inject scoped styles (exact copy from concept)
        if (!document.getElementById('qb-styles')) {
            const s = document.createElement('style'); s.id = 'qb-styles';
            s.textContent = `
              /* ORBS */
              .qb-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
              .qb-orb{position:absolute;border-radius:50%;filter:blur(90px)}
              .qb-orb1{width:600px;height:600px;background:hsla(38,92%,50%,.07);top:-180px;left:-180px;animation:qbd1 18s ease-in-out infinite}
              .qb-orb2{width:450px;height:450px;background:hsla(270,80%,65%,.08);bottom:-100px;right:-100px;animation:qbd2 22s ease-in-out infinite}
              .qb-orb3{width:360px;height:360px;background:hsla(190,92%,60%,.08);bottom:5%;left:25%;animation:qbd3 26s ease-in-out infinite}
              @keyframes qbd1{0%,100%{transform:translate(0,0)}50%{transform:translate(70px,50px)}}
              @keyframes qbd2{0%,100%{transform:translate(0,0)}50%{transform:translate(-70px,-70px)}}
              @keyframes qbd3{0%,100%{transform:translate(0,0)}50%{transform:translate(40px,-50px)}}
              /* PAGE */
              .qb-page{position:relative;z-index:1;display:flex;flex-direction:column;min-height:100vh;font-family:'Inter',system-ui,sans-serif}
              .qb-top{display:flex;align-items:center;justify-content:space-between;padding:28px 36px 0;max-width:1200px;margin:0 auto;width:100%}
              .qb-back{display:inline-flex;align-items:center;gap:7px;font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;transition:color .2s;padding:0}
              .qb-back:hover{color:var(--t-fg)}
              .qb-top-actions{display:flex;gap:8px}
              .qb-head{padding:28px 36px 24px;max-width:1200px;margin:0 auto;width:100%}
              .qb-title{font-size:clamp(2rem,3.5vw,2.8rem);font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:6px}
              .qb-sub{font-size:15px;color:var(--t-muted)}
              .qb-body{display:flex;flex:1;gap:0;max-width:1200px;margin:0 auto;width:100%;padding:0 36px 60px}
              .qb-sidebar{width:240px;flex-shrink:0;padding-right:24px;position:sticky;top:24px;height:fit-content}
              .qb-sb-section{margin-bottom:28px}
              .qb-sb-title{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:10px}
              .qb-sb-chip{display:flex;align-items:center;gap:8px;width:100%;padding:8px 12px;border-radius:9px;border:1px solid transparent;background:transparent;color:var(--t-muted);font-size:13px;font-weight:500;cursor:pointer;transition:all .2s;text-align:left;margin-bottom:4px}
              .qb-sb-chip:hover{background:var(--t-surface-hover);color:var(--t-fg)}
              .qb-sb-chip.on{background:var(--t-bar-track);border-color:var(--t-border2);color:var(--t-fg)}
              .qb-sb-chip .cdot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
              .qb-sb-chip .ccnt{margin-left:auto;font-size:11px;padding:1px 7px;border-radius:99px;background:var(--t-border)}
              .qb-divider{height:1px;background:var(--t-border);margin:4px 0 16px}
              .qb-tag-chips{display:flex;flex-wrap:wrap;gap:6px}
              .qb-tag-chip{padding:4px 10px;border-radius:6px;border:1px solid var(--t-border);background:transparent;color:var(--t-muted);font-size:11px;font-weight:500;cursor:pointer;transition:all .2s}
              .qb-tag-chip:hover{border-color:var(--t-border2);color:var(--t-fg)}
              .qb-tag-chip.on{border-color:var(--t-border2);background:var(--t-bar-track);color:var(--t-fg)}
              .qb-main{flex:1;min-width:0}
              .qb-search-row{display:flex;align-items:center;gap:10px;margin-bottom:20px}
              .qb-search-wrap{flex:1;position:relative}
              .qb-search-ico{position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:15px;color:var(--t-muted);pointer-events:none}
              .qb-search-input{width:100%;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:10px;padding:11px 14px 11px 42px;font-size:14px;color:var(--t-fg);outline:none;font-family:inherit;transition:border-color .2s,box-shadow .2s}
              .qb-search-input:focus{border-color:hsla(38,92%,50%,.5);box-shadow:0 0 0 3px hsla(38,92%,50%,.07)}
              .qb-search-input::placeholder{color:var(--t-muted)}
              .qb-sort-btn{padding:10px 14px;border-radius:9px;border:1px solid var(--t-border);background:transparent;color:var(--t-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;white-space:nowrap}
              .qb-sort-btn:hover{border-color:var(--t-border2);color:var(--t-fg)}
              .qb-sort-btn.on{border-color:hsla(38,92%,50%,.4);background:hsla(38,92%,50%,.08);color:hsl(38,92%,50%)}
              .qb-count{font-size:12px;font-weight:500;color:var(--t-muted);margin-bottom:14px}
              .qb-list{display:flex;flex-direction:column;gap:10px}
              .qb-card{background:var(--t-surface);border:1px solid var(--t-border);border-radius:14px;overflow:hidden;transition:all .25s;cursor:pointer;position:relative}
              .qb-card:hover{border-color:var(--t-border2);background:var(--t-surface-hover)}
              .qb-card.expanded{border-color:var(--t-border2);background:var(--t-surface-hover)}
              .qb-card-head{display:flex;align-items:flex-start;gap:12px;padding:16px 18px}
              .qb-fav{background:none;border:none;cursor:pointer;font-size:16px;flex-shrink:0;margin-top:1px;transition:transform .2s;line-height:1}
              .qb-fav:hover{transform:scale(1.2)}
              .qb-q-main{flex:1;min-width:0}
              .qb-q-text{font-size:14px;font-weight:600;color:var(--t-fg);line-height:1.55;margin-bottom:10px}
              .qb-badges{display:flex;flex-wrap:wrap;gap:6px}
              .qb-badge{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;padding:3px 9px;border-radius:6px;border:1px solid}
              .qb-card-actions{display:flex;align-items:center;gap:4px;flex-shrink:0;margin-top:2px}
              .qb-icon-btn{width:28px;height:28px;border-radius:7px;border:none;background:transparent;color:var(--t-muted);cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:13px;transition:all .2s}
              .qb-icon-btn:hover{background:var(--t-bar-track);color:var(--t-fg)}
              .qb-icon-btn.del:hover{background:rgba(248,113,113,.1);color:#f87171}
              .qb-tip{display:none;padding:0 18px 16px 58px;animation:qbSlide .25s ease}
              .qb-card.expanded .qb-tip{display:block}
              .qb-tip-inner{background:hsla(38,92%,50%,.05);border:1px solid hsla(38,92%,50%,.18);border-radius:10px;padding:14px 16px;display:flex;gap:10px;align-items:flex-start}
              .qb-tip-ico{flex-shrink:0;font-size:15px;margin-top:1px}
              .qb-tip-text{font-size:13px;color:var(--t-fg);line-height:1.65}
              @keyframes qbSlide{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:translateY(0)}}
              .qb-empty{text-align:center;padding:60px;border:1px solid var(--t-border);border-radius:16px;background:var(--t-surface)}
              .qb-empty-ico{font-size:40px;margin-bottom:12px;opacity:.4}
              .qb-empty p{color:var(--t-muted);font-size:14px}
              /* PANELS */
              .qb-gen-panel{max-width:1200px;margin:0 auto 24px;width:calc(100% - 72px);background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.25);border-radius:16px;padding:24px 28px;display:none;animation:qbSlide .3s ease}
              .qb-gen-panel.open{display:block}
              .qb-gen-title{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:#a78bfa;margin-bottom:18px}
              .qb-gen-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:18px}
              .qb-gen-label{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:8px}
              .qb-gen-chip{padding:6px 14px;border-radius:99px;border:1px solid var(--t-border);background:transparent;color:var(--t-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
              .qb-gen-chip:hover{border-color:rgba(124,58,237,.4);color:#a78bfa}
              .qb-gen-chip.on{background:rgba(124,58,237,.15);border-color:rgba(124,58,237,.5);color:#a78bfa}
              .qb-gen-input{width:100%;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:9px;padding:9px 14px;font-size:13px;color:var(--t-fg);outline:none;font-family:inherit;transition:border-color .2s}
              .qb-gen-input:focus{border-color:rgba(124,58,237,.5)}
              .qb-gen-input::placeholder{color:var(--t-muted)}
              .qb-gen-go{padding:10px 24px;border-radius:10px;background:linear-gradient(135deg,#7c3aed,#4f46e5);color:#fff;font-size:13px;font-weight:700;border:none;cursor:pointer;transition:all .2s}
              .qb-gen-go:hover{transform:translateY(-1px)}
              .qb-gen-go:disabled{opacity:.5;cursor:wait}
              .qb-gen-cancel{font-size:13px;font-weight:500;color:var(--t-muted);background:none;border:none;cursor:pointer;transition:color .2s}
              .qb-gen-cancel:hover{color:var(--t-fg)}
              .qb-gen-preview{background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.3);border-radius:12px;padding:20px;margin-top:16px;display:none;animation:qbSlide .3s ease}
              .qb-gen-preview.open{display:block}
              .qb-gen-preview-tag{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a78bfa;margin-bottom:8px}
              .qb-gen-preview-q{font-size:15px;font-weight:600;color:var(--t-heading);margin-bottom:14px;line-height:1.5}
              .qb-gen-preview-tip{background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.2);border-radius:9px;padding:12px 14px;font-size:13px;color:var(--t-fg);line-height:1.6;margin-bottom:14px}
              .qb-gen-confirm{padding:9px 20px;border-radius:9px;background:rgba(124,58,237,.8);color:#fff;font-size:13px;font-weight:700;border:none;cursor:pointer;transition:all .2s}
              .qb-gen-confirm:hover{background:rgba(124,58,237,1)}
              .qb-add-panel{max-width:1200px;margin:0 auto 24px;width:calc(100% - 72px);background:var(--t-surface);border:1px solid var(--t-border2);border-radius:16px;padding:24px 28px;display:none;animation:qbSlide .3s ease}
              .qb-add-panel.open{display:block}
              .qb-add-title{font-size:15px;font-weight:700;color:var(--t-fg);margin-bottom:18px}
              .qb-add-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:16px}
              .qb-add-label{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:8px}
              .qb-add-input{width:100%;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:9px;padding:9px 14px;font-size:13px;color:var(--t-fg);outline:none;font-family:inherit;transition:border-color .2s}
              .qb-add-input:focus{border-color:hsla(38,92%,50%,.5)}
              .qb-add-input::placeholder{color:var(--t-muted)}
              .qb-add-textarea{resize:none;min-height:80px}
              .qb-add-tgl{padding:6px 12px;border-radius:8px;border:1px solid var(--t-border);background:transparent;color:var(--t-muted);font-size:12px;font-weight:600;cursor:pointer;transition:all .2s}
              .qb-add-tgl:hover{border-color:var(--t-border2);color:var(--t-fg)}
              .qb-add-tgl.on{border-color:hsla(38,92%,50%,.5);background:hsla(38,92%,50%,.1);color:hsl(38,92%,50%)}
              .qb-add-save{padding:10px 22px;border-radius:9px;background:hsl(38,92%,50%);color:#000;font-size:13px;font-weight:700;border:none;cursor:pointer;transition:all .2s}
              .qb-add-save:hover{transform:translateY(-1px);box-shadow:0 6px 20px -4px hsla(38,92%,50%,.4)}
              .qb-add-save:disabled{opacity:.5;cursor:not-allowed}
              .qb-add-btn{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;border-radius:10px;background:var(--t-surface);border:1px solid var(--t-border2);color:var(--t-fg);font-size:13px;font-weight:600;cursor:pointer;transition:all .2s}
              .qb-add-btn:hover{background:var(--t-border)}
              .qb-spinner{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:qbSpin .6s linear infinite}
              @keyframes qbSpin{to{transform:rotate(360deg)}}
              /* -- Generate Button (exact copy from concept) -- */
              .qb-gbtn{--round:0.75rem;cursor:pointer;position:relative;display:inline-flex;align-items:center;justify-content:center;overflow:hidden;transition:all 0.25s ease;background:radial-gradient(65.28% 65.28% at 50% 100%,rgba(223,113,255,0.8) 0%,rgba(223,113,255,0) 100%),linear-gradient(0deg,#7a5af8,#7a5af8);border-radius:var(--round);border:none;outline:none;padding:12px 18px}
              .qb-gbtn::before,.qb-gbtn::after{content:"";position:absolute;inset:var(--space);transition:all 0.5s ease-in-out;border-radius:calc(var(--round) - var(--space));z-index:0}
              .qb-gbtn::before{--space:1px;background:linear-gradient(177.95deg,rgba(255,255,255,0.19) 0%,rgba(255,255,255,0) 100%)}
              .qb-gbtn::after{--space:2px;background:radial-gradient(65.28% 65.28% at 50% 100%,rgba(223,113,255,0.8) 0%,rgba(223,113,255,0) 100%),linear-gradient(0deg,#7a5af8,#7a5af8)}
              .qb-gbtn:active{transform:scale(0.95)}
              .qb-fold{z-index:1;position:absolute;top:0;right:0;height:1rem;width:1rem;display:inline-block;transition:all 0.5s ease-in-out;background:radial-gradient(100% 75% at 55%,rgba(223,113,255,0.8) 0%,rgba(223,113,255,0) 100%);box-shadow:0 0 3px black;border-bottom-left-radius:0.5rem;border-top-right-radius:var(--round)}
              .qb-fold::after{content:"";position:absolute;top:0;right:0;width:150%;height:150%;transform:rotate(45deg) translateX(0%) translateY(-18px);background-color:#e8e8e8;pointer-events:none}
              .qb-gbtn:hover .qb-fold{margin-top:-1rem;margin-right:-1rem}
              .qb-pts{overflow:hidden;width:100%;height:100%;pointer-events:none;position:absolute;z-index:1}
              .qb-pts .pt{bottom:-10px;position:absolute;animation:qbFloat infinite ease-in-out;pointer-events:none;width:2px;height:2px;background-color:#fff;border-radius:9999px}
              @keyframes qbFloat{0%{transform:translateY(0)}85%{opacity:0}100%{transform:translateY(-55px);opacity:0}}
              .qb-pts .pt:nth-child(1){left:10%;opacity:1;animation-duration:2.35s;animation-delay:0.2s}
              .qb-pts .pt:nth-child(2){left:30%;opacity:0.7;animation-duration:2.5s;animation-delay:0.5s}
              .qb-pts .pt:nth-child(3){left:25%;opacity:0.8;animation-duration:2.2s;animation-delay:0.1s}
              .qb-pts .pt:nth-child(4){left:44%;opacity:0.6;animation-duration:2.05s}
              .qb-pts .pt:nth-child(5){left:50%;opacity:1;animation-duration:1.9s}
              .qb-pts .pt:nth-child(6){left:75%;opacity:0.5;animation-duration:1.5s;animation-delay:1.5s}
              .qb-pts .pt:nth-child(7){left:88%;opacity:0.9;animation-duration:2.2s;animation-delay:0.2s}
              .qb-pts .pt:nth-child(8){left:58%;opacity:0.8;animation-duration:2.25s;animation-delay:0.2s}
              .qb-pts .pt:nth-child(9){left:98%;opacity:0.6;animation-duration:2.6s;animation-delay:0.1s}
              .qb-pts .pt:nth-child(10){left:65%;opacity:1;animation-duration:2.5s;animation-delay:0.2s}
              .qb-gbtn-inner{z-index:2;gap:6px;position:relative;width:100%;color:white;display:inline-flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;line-height:1.5}
              .qb-gbtn-inner svg.qb-icon{width:18px;height:18px;transition:fill 0.1s linear;fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round;stroke-width:2.5}
              .qb-gbtn:focus svg.qb-icon{fill:white}
              .qb-gbtn:hover svg.qb-icon{fill:transparent;animation:qbDash 1s linear forwards,qbFilled 0.1s linear forwards 0.95s}
              @keyframes qbDash{from{stroke-dasharray:0 0 0 0}to{stroke-dasharray:68 68 0 0}}
              @keyframes qbFilled{to{fill:white}}
            `;
            document.head.appendChild(s);
        }

        mainContent.innerHTML = `
            <div class="qb-wrap" style="position:relative;min-height:100vh;background:var(--t-bg-solid);overflow-x:hidden">
            <!-- ORBS -->
            <div class="qb-orbs"><div class="qb-orb qb-orb1"></div><div class="qb-orb qb-orb2"></div><div class="qb-orb qb-orb3"></div></div>

            <div class="qb-page" x-data="questionBank()" x-init="loadQuestions()">
              <!-- Top bar -->
              <div class="qb-top">
                <button class="qb-back" onclick="window.nav('hero')">&#8592; Back to Home</button>
                <div class="qb-top-actions">
                  <button type="button" class="qb-gbtn" @click="showGenForm = !showGenForm; showAddForm = false">
                    <span class="qb-fold"></span>
                    <div class="qb-pts">
                      <i class="pt"></i><i class="pt"></i><i class="pt"></i><i class="pt"></i><i class="pt"></i>
                      <i class="pt"></i><i class="pt"></i><i class="pt"></i><i class="pt"></i><i class="pt"></i>
                    </div>
                    <span class="qb-gbtn-inner">
                      <svg class="qb-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <polyline points="13.18 1.37 13.18 9.64 21.45 9.64 10.82 22.63 10.82 14.36 2.55 14.36 13.18 1.37"></polyline>
                      </svg>Generate with AI
                    </span>
                  </button>
                  <button class="qb-add-btn" @click="resetForm(); showAddForm = !showAddForm; showGenForm = false">+ Add Question</button>
                </div>
              </div>

              <!-- Page heading -->
              <div class="qb-head">
                <div class="qb-title">Question Bank</div>
                <div class="qb-sub">Browse, filter, and favorite interview questions. Add your own or generate with AI.</div>
              </div>

              <!-- AI Generate panel -->
              <div class="qb-gen-panel" :class="showGenForm && !showGenPreview ? 'open' : ''">
                <div class="qb-gen-title">&#10024; Generate with AI</div>
                <div class="qb-gen-row">
                  <div>
                    <div class="qb-gen-label">Module</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <template x-for="m in ['Roleplay','Visual','Technical','General','Case Study','Salary']" :key="m">
                        <button class="qb-gen-chip" :class="genModule === m ? 'on' : ''" @click="genModule = m" x-text="m"></button>
                      </template>
                    </div>
                  </div>
                  <div>
                    <div class="qb-gen-label">Difficulty</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <template x-for="d in ['Easy','Medium','Hard']" :key="d">
                        <button class="qb-gen-chip" :class="genLevel === d ? 'on' : ''" @click="genLevel = d" x-text="d"></button>
                      </template>
                    </div>
                  </div>
                  <div>
                    <div class="qb-gen-label">Topic Hint <span style="color:var(--t-muted);font-size:10px;text-transform:none">(optional)</span></div>
                    <input class="qb-gen-input" x-model="genTopic" placeholder="e.g. System Design, Leadership...">
                  </div>
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                  <button class="qb-gen-go" @click="generateQuestion()" :disabled="generating">
                    <span x-show="generating" class="qb-spinner" style="margin-right:6px"></span>
                    <span x-text="generating ? 'Generating...' : 'Generate'"></span>
                  </button>
                  <button class="qb-gen-cancel" @click="showGenForm = false">Cancel</button>
                </div>
                <!-- Preview -->
                <div class="qb-gen-preview" :class="showGenPreview ? 'open' : ''">
                  <div class="qb-gen-preview-tag">&#10024; AI-Generated Question</div>
                  <div class="qb-gen-preview-q" x-text="genPreview.text"></div>
                  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
                    <span class="qb-badge" style="border-color:var(--t-border2);background:var(--t-surface-hover);color:var(--t-muted)" x-text="genPreview.category"></span>
                    <span class="qb-badge" style="border-color:rgba(250,204,21,.3);background:rgba(250,204,21,.08);color:#facc15" x-text="genPreview.difficulty"></span>
                    <template x-for="t in (genPreview.tags || [])" :key="t">
                      <span class="qb-badge" style="border-color:var(--t-border2);background:var(--t-surface-hover);color:var(--t-muted)" x-text="t"></span>
                    </template>
                  </div>
                  <div class="qb-gen-preview-tip" x-show="genPreview.answer">&#128161; <strong>Tip:</strong> <span x-text="genPreview.answer"></span></div>
                  <div style="display:flex;align-items:center;gap:10px">
                    <button class="qb-gen-confirm" @click="confirmGenerated()">Add to Bank</button>
                    <button class="qb-gen-go" style="background:var(--t-border);border:1px solid var(--t-border2)" @click="generateQuestion()" :disabled="generating">
                      <span x-text="generating ? 'Regenerating...' : 'Regenerate'"></span>
                    </button>
                    <button class="qb-gen-cancel" @click="showGenPreview = false; showGenForm = true">Dismiss</button>
                  </div>
                </div>
              </div>

              <!-- Add Question panel -->
              <div class="qb-add-panel" :class="showAddForm ? 'open' : ''">
                <div class="qb-add-title" x-text="editingId ? 'Edit Question' : 'Add Custom Question'"></div>
                <textarea class="qb-add-input qb-add-textarea" x-model="newQText" placeholder="Enter your interview question..." style="width:100%;margin-bottom:16px"></textarea>
                <div class="qb-add-grid">
                  <div>
                    <div class="qb-add-label">Module</div>
                    <div style="display:flex;gap:6px;flex-wrap:wrap">
                      <template x-for="m in ['Roleplay','Visual','Technical','General','Case Study','Salary']" :key="m">
                        <button class="qb-add-tgl" :class="newQModule === m ? 'on' : ''" @click="newQModule = m" x-text="m"></button>
                      </template>
                    </div>
                  </div>
                  <div>
                    <div class="qb-add-label">Difficulty</div>
                    <div style="display:flex;gap:6px">
                      <template x-for="d in ['Easy','Medium','Hard']" :key="d">
                        <button class="qb-add-tgl" :class="newQLevel === d ? 'on' : ''" @click="newQLevel = d" x-text="d"></button>
                      </template>
                    </div>
                  </div>
                  <div>
                    <div class="qb-add-label">Category / Tag</div>
                    <input class="qb-add-input" x-model="newQCategory" placeholder="e.g. Leadership">
                  </div>
                </div>
                <div>
                  <div class="qb-add-label">Preparation Tip <span style="color:var(--t-muted);font-size:10px;text-transform:none">(optional)</span></div>
                  <input class="qb-add-input" x-model="newQTip" placeholder="A helpful tip for answering this question" style="margin-bottom:16px">
                </div>
                <div style="display:flex;align-items:center;gap:10px">
                  <button class="qb-add-save" @click="submitQuestion()" :disabled="!newQText.trim()">
                    <span x-text="editingId ? 'Update Question' : 'Save Question'"></span>
                  </button>
                  <button class="qb-gen-cancel" @click="showAddForm = false; resetForm()">Cancel</button>
                </div>
              </div>

              <!-- Body: Sidebar + Main -->
              <div class="qb-body">
                <!-- SIDEBAR -->
                <aside class="qb-sidebar">
                  <div class="qb-sb-section">
                    <div class="qb-sb-title">Module</div>
                    <button class="qb-sb-chip" :class="activeModule === 'All Modules' ? 'on' : ''" @click="activeModule = 'All Modules'">
                      <span class="cdot" style="background:var(--t-muted)"></span> All Modules
                      <span class="ccnt" x-text="questions.length"></span>
                    </button>
                    <template x-for="mod in ['Roleplay','Visual','Technical','General','Case Study','Salary']" :key="mod">
                      <button class="qb-sb-chip" :class="activeModule === mod ? 'on' : ''" @click="activeModule = mod">
                        <span class="cdot" :style="'background:' + (window._qbModColor[mod]||'#84cc16')"></span>
                        <span x-text="mod"></span>
                        <span class="ccnt" x-text="questions.filter(q => q.category === mod).length"></span>
                      </button>
                    </template>
                  </div>
                  <div class="qb-divider"></div>
                  <div class="qb-sb-section">
                    <div class="qb-sb-title">Difficulty</div>
                    <button class="qb-sb-chip" :class="activeLevel === 'All Levels' ? 'on' : ''" @click="activeLevel = 'All Levels'">
                      <span class="cdot" style="background:var(--t-muted)"></span> All Levels
                    </button>
                    <template x-for="d in ['Easy','Medium','Hard']" :key="d">
                      <button class="qb-sb-chip" :class="activeLevel === d ? 'on' : ''" @click="activeLevel = d">
                        <span class="cdot" :style="'background:' + (window._qbDiffColor[d]||'#facc15')"></span>
                        <span x-text="d"></span>
                      </button>
                    </template>
                  </div>
                  <div class="qb-divider"></div>
                  <div class="qb-sb-section">
                    <div class="qb-sb-title">Special</div>
                    <button class="qb-sb-chip" :class="showFavorites ? 'on' : ''" @click="showFavorites = !showFavorites">
                      <span class="cdot" style="background:#facc15"></span> &#11088; Favorites Only
                    </button>
                    <button class="qb-sb-chip" :class="showCustomOnly ? 'on' : ''" @click="showCustomOnly = !showCustomOnly">
                      <span class="cdot" style="background:hsl(38,92%,50%)"></span> Custom Only
                    </button>
                  </div>
                  <div class="qb-divider"></div>
                  <div class="qb-sb-section">
                    <div class="qb-sb-title">Tags</div>
                    <div class="qb-tag-chips">
                      <button class="qb-tag-chip" :class="activeCategory === 'All Categories' ? 'on' : ''" @click="activeCategory = 'All Categories'">All</button>
                      <template x-for="cat in allCategories" :key="cat">
                        <button class="qb-tag-chip" :class="activeCategory === cat ? 'on' : ''" @click="activeCategory = cat" x-text="cat"></button>
                      </template>
                    </div>
                  </div>
                </aside>

                <!-- MAIN -->
                <div class="qb-main">
                  <div class="qb-search-row">
                    <div class="qb-search-wrap">
                      <span class="qb-search-ico">&#128269;</span>
                      <input class="qb-search-input" x-model="searchTerm" placeholder="Search questions...">
                    </div>
                    <button class="qb-sort-btn" :class="sortCustomFirst ? 'on' : ''" @click="toggleSort()">&#8597; <span x-text="sortCustomFirst ? 'Custom First' : 'Default Order'"></span></button>
                  </div>
                  <div class="qb-count">
                    <span x-show="loading">Loading questions...</span>
                    <span x-show="!loading" x-text="filteredQuestions.length + ' questions'"></span>
                  </div>
                  <div class="qb-list">
                    <template x-for="q in filteredQuestions" :key="q.id">
                      <div class="qb-card" :class="expanded === q.id ? 'expanded' : ''" @click="expanded = expanded === q.id ? null : q.id">
                        <div :style="'position:absolute;left:0;top:0;bottom:0;width:3px;background:' + (window._qbModColor[q.category]||'#84cc16') + ';border-radius:3px 0 0 3px'"></div>
                        <div class="qb-card-head">
                          <button class="qb-fav" @click.stop="toggleFavorite(q.id)" title="Favorite">
                            <span x-text="favorites.includes(q.id) ? '&#11088;' : '&#9734;'"></span>
                          </button>
                          <div class="qb-q-main">
                            <div class="qb-q-text" x-text="q.text"></div>
                            <div class="qb-badges">
                              <span class="qb-badge" :style="'color:' + (window._qbModColor[q.category]||'#84cc16') + ';background:' + (window._qbModColor[q.category]||'#84cc16') + '18;border-color:' + (window._qbModColor[q.category]||'#84cc16') + '40'" x-text="q.category"></span>
                              <span class="qb-badge" :style="'color:' + (window._qbDiffColor[q.difficulty]||'#facc15') + ';background:' + (window._qbDiffColor[q.difficulty]||'#facc15') + '18;border-color:' + (window._qbDiffColor[q.difficulty]||'#facc15') + '40'" x-text="q.difficulty"></span>
                              <template x-for="tag in (q.tags||[])" :key="tag">
                                <span class="qb-badge" style="border-color:var(--t-border2);background:var(--t-surface-hover);color:var(--t-muted)" x-text="tag"></span>
                              </template>
                              <template x-if="!q.is_seed">
                                <span class="qb-badge" style="border-color:hsla(38,92%,50%,.3);background:hsla(38,92%,50%,.08);color:hsl(38,92%,50%)">Custom</span>
                              </template>
                            </div>
                          </div>
                          <div class="qb-card-actions">
                            <template x-if="!q.is_seed">
                              <button class="qb-icon-btn" @click.stop="startEdit(q)" title="Edit">&#9998;</button>
                            </template>
                            <template x-if="!q.is_seed">
                              <button class="qb-icon-btn del" @click.stop="deleteQuestion(q.id)" title="Delete">&#128465;</button>
                            </template>
                            <button class="qb-icon-btn" style="font-size:14px" x-text="expanded === q.id ? '&#9650;' : '&#9661;'"></button>
                          </div>
                        </div>
                        <div class="qb-tip">
                          <div class="qb-tip-inner">
                            <span class="qb-tip-ico">&#128161;</span>
                            <div class="qb-tip-text" x-text="q.answer || 'Focus on structuring your thoughts clearly using the STAR method.'"></div>
                          </div>
                        </div>
                      </div>
                    </template>
                    <template x-if="!loading && filteredQuestions.length === 0">
                      <div class="qb-empty"><div class="qb-empty-ico">&#128269;</div><p>No questions match your filters.</p></div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
            </div>
        `;

        // Expose color maps for Alpine templates
        window._qbModColor = MOD_COLOR;
        window._qbDiffColor = DIFF_COLOR;

        // Register the Alpine.js component
        if (!window._questionBankRegistered) {
            window._questionBankRegistered = true;
            document.addEventListener('alpine:init', () => {
                Alpine.data('questionBank', () => window._questionBankComponent());
            });
        }

        // Define the component factory
        window._questionBankComponent = () => ({
            questions: [],
            loading: true,
            expanded: null,
            searchTerm: '',
            activeModule: 'All Modules',
            activeLevel: 'All Levels',
            activeCategory: 'All Categories',
            showFavorites: false,
            showCustomOnly: false,
            favorites: JSON.parse(localStorage.getItem('qb_favorites') || '[]'),
            showAddForm: false,
            editingId: null,
            newQText: '', newQModule: 'Roleplay', newQLevel: 'Medium', newQCategory: '', newQTip: '',
            sortCustomFirst: false,
            generating: false,
            showGenForm: false,
            showGenPreview: false,
            genModule: 'Technical',
            genLevel: 'Medium',
            genTopic: '',
            genPreview: { text: '', category: '', difficulty: '', tags: [], answer: '' },

            get allCategories() {
                const tags = new Set();
                this.questions.forEach(q => {
                    if (q.tags) q.tags.forEach(t => { if (t) tags.add(t); });
                });
                return [...tags].sort();
            },

            get filteredQuestions() {
                let result = this.questions.filter(q => {
                    if (this.activeModule !== 'All Modules' && q.category !== this.activeModule) return false;
                    if (this.activeLevel !== 'All Levels' && q.difficulty !== this.activeLevel) return false;
                    if (this.activeCategory !== 'All Categories' && !(q.tags && q.tags.includes(this.activeCategory))) return false;
                    if (this.searchTerm && !q.text.toLowerCase().includes(this.searchTerm.toLowerCase())) return false;
                    if (this.showFavorites && !this.favorites.includes(q.id)) return false;
                    if (this.showCustomOnly && q.is_seed) return false;
                    return true;
                });
                if (this.sortCustomFirst) {
                    result.sort((a, b) => {
                        if (!a.is_seed && b.is_seed) return -1;
                        if (a.is_seed && !b.is_seed) return 1;
                        return 0;
                    });
                }
                return result;
            },

            async loadQuestions() {
                this.loading = true;
                try {
                    const res = await fetch('/api/questions');
                    const data = await res.json();
                    this.questions = data.questions || [];
                } catch (e) {
                    console.error('Failed to load questions:', e);
                    this.questions = [];
                }
                this.loading = false;
            },

            resetForm() {
                this.newQText = ''; this.newQModule = 'Roleplay'; this.newQLevel = 'Medium';
                this.newQCategory = ''; this.newQTip = ''; this.editingId = null;
            },

            startEdit(q) {
                this.editingId = q.id;
                this.newQText = q.text;
                this.newQModule = q.category;
                this.newQLevel = q.difficulty;
                this.newQCategory = q.tags && q.tags.length > 0 ? q.tags[0] : '';
                this.newQTip = q.answer || '';
                this.showAddForm = true;
                window.scrollTo({ top: 0, behavior: 'smooth' });
            },

            async submitQuestion() {
                const newQ = {
                    id: this.editingId || crypto.randomUUID(),
                    category: this.newQModule,
                    text: this.newQText,
                    difficulty: this.newQLevel,
                    tags: [this.newQCategory],
                    answer: this.newQTip,
                    is_seed: false
                };
                const url = this.editingId ? '/api/questions/' + this.editingId : '/api/questions';
                const method = this.editingId ? 'PUT' : 'POST';
                if (this.editingId) {
                    const idx = this.questions.findIndex(q => q.id === this.editingId);
                    if (idx !== -1) this.questions.splice(idx, 1, newQ);
                } else {
                    this.questions.push(newQ);
                }
                this.showAddForm = false;
                this.resetForm();
                try {
                    await fetch(url, {
                        method, headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newQ)
                    });
                } catch (e) { console.error('Failed to save question:', e); }
            },

            async deleteQuestion(id) {
                if (!confirm('Are you sure you want to delete this question?')) return;
                this.questions = this.questions.filter(q => q.id !== id);
                if (this.activeCategory !== 'All Categories' && !this.allCategories.includes(this.activeCategory)) {
                    this.activeCategory = 'All Categories';
                }
                try { await fetch('/api/questions/' + id, { method: 'DELETE' }); }
                catch (e) { console.error('Failed to delete question:', e); }
            },

            toggleFavorite(id) {
                if (this.favorites.includes(id)) {
                    this.favorites = this.favorites.filter(fid => fid !== id);
                } else {
                    this.favorites.push(id);
                }
                localStorage.setItem('qb_favorites', JSON.stringify(this.favorites));
            },

            toggleSort() {
                this.sortCustomFirst = !this.sortCustomFirst;
            },

            async generateQuestion() {
                this.generating = true;
                const wasPreviewOpen = this.showGenPreview;
                if (!wasPreviewOpen) this.showGenPreview = false;
                const payload = {
                    category: this.genModule,
                    difficulty: this.genLevel
                };
                if (this.genTopic) payload.topic = this.genTopic;
                try {
                    const res = await fetch('/api/generate-question', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload)
                    });
                    if (!res.ok) throw new Error('Generation failed');
                    const result = await res.json();
                    if (this.genTopic && result.tags) {
                        result.tags = [this.genTopic];
                    }
                    this.genPreview = result;
                    this.showGenPreview = true;
                    this.showGenForm = false;
                } catch (e) {
                    console.error('Failed to generate question:', e);
                    alert('Failed to generate question. Make sure Ollama is running with the qwen2.5:7b model.');
                    if (!wasPreviewOpen) this.showGenForm = true;
                }
                this.generating = false;
            },

            async confirmGenerated() {
                const newQ = {
                    id: crypto.randomUUID(),
                    category: this.genPreview.category || 'Technical',
                    text: this.genPreview.text,
                    difficulty: this.genPreview.difficulty || 'Medium',
                    tags: this.genPreview.tags || ['General'],
                    answer: this.genPreview.answer || '',
                    is_seed: false
                };
                this.questions.push(newQ);
                this.showGenPreview = false;
                this.showGenForm = false;
                try {
                    await fetch('/api/questions', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newQ)
                    });
                } catch (e) { console.error('Failed to save generated question:', e); }
            }
        });

        // If Alpine is already loaded, manually initialize
        if (window.Alpine) {
            try { Alpine.data('questionBank', () => window._questionBankComponent()); } catch (e) { }
            Alpine.initTree(mainContent);
        }
    }


    // ═══════════════════════════════════════════════════════════
    // ███  MINI-GAMES  ████████████████████████████████████████
    // ═══════════════════════════════════════════════════════════

    function renderGames() {
        const blitzBest = readStoredJSON('mg_blitz_best', null);
        const starBest = readStoredJSON('mg_star_best', null);
        const salaryBest = readStoredJSON('mg_salary_best', null);
        const recentRuns = getMinigameRuns().slice(0, 3);
        const rec = getRecommendedDrillFromLatestFeedback();
        const recMeta = MG_META[rec.game] || MG_META.star;

        mainContent.innerHTML = `
        <style>
        .mg-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);font-family:'Inter',system-ui,sans-serif;color:var(--t-fg);overflow-y:auto}
        .mg-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
        .mg-orb{position:absolute;border-radius:50%;filter:blur(100px)}
        .mg-orb1{width:600px;height:600px;background:hsla(38,85%,50%,.06);top:-200px;left:-180px;animation:mgd1 20s ease-in-out infinite}
        .mg-orb2{width:500px;height:500px;background:hsla(280,70%,55%,.05);bottom:-120px;right:-100px;animation:mgd2 24s ease-in-out infinite}
        @keyframes mgd1{0%,100%{transform:translate(0,0)}50%{transform:translate(60px,50px)}}
        @keyframes mgd2{0%,100%{transform:translate(0,0)}50%{transform:translate(-60px,-60px)}}
        .mg-page{position:relative;z-index:1;max-width:900px;margin:0 auto;padding:48px 28px 80px}
        .mg-back{font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;padding:0;transition:color .2s;font-family:inherit;margin-bottom:28px;display:inline-block}
        .mg-back:hover{color:var(--t-fg)}
        .mg-hero{text-align:center;margin-bottom:48px}
        .mg-hero h1{font-size:clamp(2rem,4vw,2.8rem);font-weight:900;letter-spacing:-.04em;color:var(--t-heading);margin-bottom:10px}
        .mg-hero p{font-size:15px;color:var(--t-muted);line-height:1.6;max-width:560px;margin:0 auto}
        .mg-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}
        .mg-card{background:var(--t-surface);border:1.5px solid var(--t-border2);border-radius:22px;padding:28px 24px;transition:all .3s;cursor:pointer;position:relative;overflow:hidden}
        .mg-card:hover{border-color:var(--t-border2);transform:translateY(-4px);box-shadow:0 16px 40px rgba(0,0,0,.4)}
        .mg-card-glow{position:absolute;top:-60px;right:-60px;width:160px;height:160px;border-radius:50%;filter:blur(60px);pointer-events:none;opacity:.4}
        .mg-card-ico{font-size:38px;margin-bottom:14px;position:relative;z-index:1}
        .mg-card h3{font-size:18px;font-weight:800;color:var(--t-heading);margin-bottom:6px;position:relative;z-index:1}
        .mg-card p{font-size:13px;color:var(--t-muted);line-height:1.6;margin-bottom:18px;position:relative;z-index:1}
        .mg-card-tags{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px;position:relative;z-index:1}
        .mg-tag{font-size:10px;font-weight:700;padding:3px 10px;border-radius:99px;letter-spacing:.04em;text-transform:uppercase}
        .mg-card-bottom{display:flex;align-items:center;justify-content:space-between;position:relative;z-index:1}
        .mg-play{padding:10px 22px;border-radius:10px;border:none;font-size:13px;font-weight:700;cursor:pointer;transition:all .2s;font-family:inherit}
        .mg-play:hover{transform:translateY(-1px)}
        .mg-best{font-size:11px;color:var(--t-muted);font-weight:600}
        .mg-best span{color:var(--t-heading);font-weight:700}
        .mg-rec{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:18px;padding:18px 20px;margin-bottom:22px}
        .mg-rec-top{display:flex;align-items:center;gap:12px}
        .mg-rec-ico{width:42px;height:42px;border-radius:12px;border:1px solid;display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0}
        .mg-rec-kicker{font-size:10px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:2px}
        .mg-rec-title{font-size:15px;font-weight:800;color:var(--t-heading)}
        .mg-rec-btn{margin-left:auto;border:none;border-radius:10px;padding:9px 16px;background:var(--t-heading);color:var(--t-bg-solid);font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:6px}
        .mg-rec-copy{font-size:12px;color:var(--t-muted);line-height:1.6;margin-top:12px}
        .mg-practice{margin-top:26px;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:18px;padding:20px}
        .mg-practice-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
        .mg-practice-title{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--t-muted);display:flex;align-items:center;gap:7px}
        .mg-run-list{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
        .mg-run{border:1px solid var(--t-border);background:var(--t-surface-dim);border-radius:12px;padding:13px}
        .mg-run-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px}
        .mg-run-game{font-size:12px;font-weight:800;color:var(--t-heading);display:flex;align-items:center;gap:6px}
        .mg-run-score{font-size:16px;font-weight:900}
        .mg-run-summary{font-size:11px;color:var(--t-muted);line-height:1.5;min-height:34px}
        .mg-empty{font-size:12px;color:var(--t-muted);line-height:1.6}
        @media(max-width:720px){.mg-run-list{grid-template-columns:1fr}.mg-rec-top{align-items:flex-start}.mg-rec-btn{margin-left:0}.mg-rec-top{flex-wrap:wrap}}
        </style>
        <div class="mg-wrap">
            <div class="mg-orbs"><div class="mg-orb mg-orb1"></div><div class="mg-orb mg-orb2"></div></div>
            ${starsHTML('mg-stars')}
            <div class="mg-page">
                <button class="mg-back" onclick="window.nav('hero')">${ti('arrow-left')} Home</button>
                <div class="mg-hero">
                    <h1>${ti('device-gamepad-2')} Mini-Games</h1>
                    <p>Sharpen your interview skills with quick, focused training games. Each game targets a different skill - speed, structure, and negotiation.</p>
                </div>
                <div class="mg-rec" id="mg-recommendation-card">
                    <div class="mg-rec-top">
                        <div class="mg-rec-ico" style="color:${recMeta.color};background:${recMeta.color}16;border-color:${recMeta.color}45">${ti(recMeta.icon)}</div>
                        <div>
                            <div class="mg-rec-kicker">Recommended drill</div>
                            <div class="mg-rec-title">${escapeHTML(recMeta.label)}</div>
                        </div>
                        <button class="mg-rec-btn" onclick="window.nav_game('${rec.game}')">${ti('player-play')} Start</button>
                    </div>
                    <div class="mg-rec-copy">${escapeHTML(rec.reason)}${rec.score !== null ? ` Weakest signal: ${escapeHTML(rec.competency.replace(/_/g, ' '))} (${rec.score}/100).` : ''}</div>
                </div>
                <div class="mg-grid">
                    <div class="mg-card" onclick="window.nav_game('blitz')">
                        <div class="mg-card-glow" style="background:hsla(38,85%,50%,.3)"></div>
                        <div class="mg-card-ico">${ti('bolt')}</div>
                        <h3>60-Second Blitz</h3>
                        <p>10 real interview questions. 60 seconds each. Train your brain to produce clear answers under pressure.</p>
                        <div class="mg-card-tags">
                            <span class="mg-tag" style="color:#fbbf24;border:1px solid rgba(251,191,36,.3);background:rgba(251,191,36,.08)">Speed</span>
                            <span class="mg-tag" style="color:#f97316;border:1px solid rgba(249,115,22,.3);background:rgba(249,115,22,.08)">Timed</span>
                            <span class="mg-tag" style="color:#ef4444;border:1px solid rgba(239,68,68,.3);background:rgba(239,68,68,.08)">Pressure</span>
                        </div>
                        <div class="mg-card-bottom">
                            <button class="mg-play" style="background:linear-gradient(135deg,#f59e0b,#fbbf24);color:#000;box-shadow:0 0 14px rgba(245,158,11,.3)">${ti('player-play')} Play</button>
                            <div class="mg-best">${blitzBest ? `Best: <span>${blitzBest.score}/100</span>` : 'No plays yet'}</div>
                        </div>
                    </div>
                    <div class="mg-card" onclick="window.nav_game('star')">
                        <div class="mg-card-glow" style="background:hsla(270,70%,55%,.3)"></div>
                        <div class="mg-card-ico">${ti('stars')}</div>
                        <h3>STAR Builder</h3>
                        <p>Practice the STAR method step-by-step. Pick a scenario, fill in each bucket, and get a structured score.</p>
                        <div class="mg-card-tags">
                            <span class="mg-tag" style="color:#a78bfa;border:1px solid rgba(167,139,250,.3);background:rgba(167,139,250,.08)">Structure</span>
                            <span class="mg-tag" style="color:#818cf8;border:1px solid rgba(129,140,248,.3);background:rgba(129,140,248,.08)">Behavioral</span>
                        </div>
                        <div class="mg-card-bottom">
                            <button class="mg-play" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;box-shadow:0 0 14px rgba(124,58,237,.3)">${ti('player-play')} Play</button>
                            <div class="mg-best">${starBest ? `Best: <span>${starBest.score}/100</span>` : 'No plays yet'}</div>
                        </div>
                    </div>
                    <div class="mg-card" onclick="window.nav_game('salary')">
                        <div class="mg-card-glow" style="background:hsla(150,65%,45%,.3)"></div>
                        <div class="mg-card-ico">${ti('cash-banknote')}</div>
                        <h3>Salary Dare</h3>
                        <p>The offer is on the table. You have 5 rounds to negotiate the best deal. Counter, justify, and hold your ground.</p>
                        <div class="mg-card-tags">
                            <span class="mg-tag" style="color:#4ade80;border:1px solid rgba(74,222,128,.3);background:rgba(74,222,128,.08)">Negotiation</span>
                            <span class="mg-tag" style="color:#34d399;border:1px solid rgba(52,211,153,.3);background:rgba(52,211,153,.08)">Strategy</span>
                        </div>
                        <div class="mg-card-bottom">
                            <button class="mg-play" style="background:linear-gradient(135deg,#059669,#10b981);color:#fff;box-shadow:0 0 14px rgba(16,185,129,.3)">${ti('player-play')} Play</button>
                            <div class="mg-best">${salaryBest ? `Best: <span>+$${salaryBest.gain?.toLocaleString()}</span>` : 'No plays yet'}</div>
                        </div>
                    </div>
                </div>
                <div class="mg-practice">
                    <div class="mg-practice-head">
                        <div class="mg-practice-title">${ti('history')} Recent Practice</div>
                        <div class="mg-best">${getMinigameRuns().length} saved run${getMinigameRuns().length === 1 ? '' : 's'}</div>
                    </div>
                    ${recentRuns.length ? `<div class="mg-run-list">${recentRuns.map(run => {
                        const meta = MG_META[run.game] || MG_META.star;
                        return `<div class="mg-run">
                            <div class="mg-run-top">
                                <div class="mg-run-game">${ti(meta.icon)} ${escapeHTML(meta.label)}</div>
                                <div class="mg-run-score" style="color:${meta.color}">${run.score}</div>
                            </div>
                            <div class="mg-run-summary">${escapeHTML(run.summary || 'Practice run saved.')}</div>
                        </div>`;
                    }).join('')}</div>` : `<div class="mg-empty">No V2 practice runs yet. Complete a game to start tracking progress here.</div>`}
                </div>
            </div>
        </div>`;
        // Init stars background for minigames hub
        initStarsBg('mg-stars');
        refreshMinigameRecommendation();
    }

    window.nav_game = function (game) {
        if (game === 'blitz') renderGame_Blitz();
        else if (game === 'star') renderGame_STAR();
        else if (game === 'salary') renderGame_Salary();
    };

    // --- 60-SECOND BLITZ ------------------------------------
    function renderGame_Blitz() {
        const ALL_QUESTIONS = [
            "Tell me about yourself - keep it to 90 seconds.",
            "What's your greatest professional strength?",
            "Describe a time you handled failure at work.",
            "Where do you see yourself in five years?",
            "Why do you want to leave your current role?",
            "What's your biggest weakness, and what are you doing about it?",
            "Tell me about a time you went above and beyond.",
            "How do you handle competing priorities and tight deadlines?",
            "What do you know about our company?",
            "Why should we hire you over other candidates?",
            "Tell me about a time you disagreed with your manager.",
            "How do you handle feedback or criticism?",
            "Describe your ideal work environment.",
            "What motivates you day-to-day?",
            "How do you stay organised and manage your time?",
            "Give me an example of a goal you achieved.",
            "Tell me about a project you're most proud of.",
            "How do you handle working under pressure?",
            "Describe a situation where you had to adapt quickly to change.",
            "What's a skill you've developed in the last year?",
        ];
        const BLITZ_DECKS = {
            general: ALL_QUESTIONS,
            behavioral: [
                "Tell me about a time you solved a difficult problem.",
                "Describe a time you worked with a difficult stakeholder.",
                "Tell me about a time you failed and what you learned.",
                "Give me an example of when you showed leadership.",
                "Describe a time you had to adapt quickly.",
                "Tell me about a time you received tough feedback.",
                "Describe a time you improved a process.",
                "Tell me about a time you influenced without authority.",
                "Give me an example of handling competing priorities.",
                "Tell me about a time you owned a mistake.",
            ],
            rolefit: [
                "Why are you interested in this role?",
                "What makes you a strong fit for this team?",
                "What would you prioritize in your first 30 days?",
                "What kind of work environment helps you do your best work?",
                "How does your recent experience map to this job?",
                "What should we know about your working style?",
                "Which requirement in the job description is your strongest match?",
                "What gap would you need to close to succeed here?",
                "Why this company or industry?",
                "What differentiates you from other candidates?",
            ],
            weak: [
                "Answer this directly: what is the strongest evidence that you can do this role?",
                "Give a concise example with a metric and outcome.",
                "Explain one project using situation, action, and result.",
                "Tell me about a time you had to adjust under pressure.",
                "Describe your impact in a way a hiring manager would remember.",
                "What did you personally own, and what changed because of it?",
                "Give a specific example that proves one core strength.",
                "What trade-off did you make, and why was it the right one?",
                "How did you measure success?",
                "What is the clearest reason we should advance you?",
            ],
        };
        const BLITZ_KEYWORDS = {
            strength: ['strength', 'strong', 'skill', 'example', 'impact'],
            failure: ['failed', 'mistake', 'learned', 'changed', 'improved'],
            conflict: ['stakeholder', 'conflict', 'disagree', 'align', 'resolved'],
            feedback: ['feedback', 'criticism', 'learned', 'changed', 'improved'],
            priority: ['priority', 'deadline', 'trade', 'impact', 'effort'],
            role: ['role', 'fit', 'experience', 'team', 'requirement'],
            company: ['company', 'industry', 'mission', 'product', 'customer'],
            impact: ['impact', 'metric', 'result', 'outcome', 'improved'],
        };

        function getBlitzDeck(name) {
            return BLITZ_DECKS[name] || BLITZ_DECKS.general;
        }

        function blitzKeywordsFor(question) {
            const q = question.toLowerCase();
            let keys = [];
            Object.entries(BLITZ_KEYWORDS).forEach(([topic, words]) => {
                if (q.includes(topic) || words.some(w => q.includes(w))) keys = keys.concat(words);
            });
            return [...new Set(keys.length ? keys : ['example', 'action', 'result', 'impact'])];
        }

        function scoreBlitzAnswer(question, answer, skipped, timeUsed, timeLimit) {
            const text = String(answer || '');
            const signals = scoreTextSignals(text);
            if (skipped || signals.word_count === 0) {
                return {
                    score: 0,
                    competency_scores: { answer_relevance: 0, specificity: 0, communication_clarity: 0, adaptability: 20 },
                    flags: ['Skipped'],
                    summary: 'No answer captured.',
                    suggested: 'Try STAR Builder to prepare one reusable example before replaying Blitz.',
                };
            }
            const keywords = blitzKeywordsFor(question);
            const tokens = new Set(tokenize(text));
            const matched = keywords.filter(k => tokens.has(k) || text.toLowerCase().includes(k));
            const relevance = clampScore(35 + (matched.length / keywords.length) * 55 + (signals.has_action_verb ? 10 : 0));
            const specificity = signals.specificity_score;
            const clarity = signals.clarity_score;
            const lengthScore = signals.word_count < 18 ? 45 : signals.word_count <= 120 ? 92 : signals.word_count <= 160 ? 76 : 55;
            const pressure = clampScore(55 + (timeUsed <= timeLimit * .85 ? 25 : 10) + (signals.word_count >= 18 ? 15 : 0));
            const score = averageScore([relevance, specificity, clarity, lengthScore, pressure]);
            const flags = [];
            if (signals.word_count < 18) flags.push('Too short');
            if (signals.word_count > 160) flags.push('Too long');
            if (matched.length === 0) flags.push('May miss the question');
            if (!signals.has_metric && !signals.has_outcome) flags.push('Needs proof');
            if (!signals.has_action_verb) flags.push('Add action');
            return {
                score,
                competency_scores: {
                    answer_relevance: relevance,
                    specificity,
                    communication_clarity: averageScore([clarity, lengthScore]),
                    adaptability: pressure,
                },
                flags,
                summary: flags.length ? flags.join(', ') : 'Direct, specific, and controlled under time pressure.',
                suggested: score >= 80 ? 'Replay on Hard mode or move to STAR Builder for deeper evidence.' : 'Add one concrete action and one measurable result before the timer ends.',
            };
        }

        const CSS = `<style>
        .bz-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);font-family:'Inter',system-ui,sans-serif;color:var(--t-fg);overflow-y:auto}
        .bz-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
        .bz-orb{position:absolute;border-radius:50%;filter:blur(100px)}
        .bz-orb1{width:700px;height:700px;background:hsla(38,85%,50%,.07);top:-300px;left:-200px;animation:mgd1 22s ease-in-out infinite}
        .bz-orb2{width:500px;height:500px;background:hsla(200,80%,60%,.06);bottom:-100px;right:-100px;animation:mgd2 26s ease-in-out infinite}
        .bz-page{position:relative;z-index:1;max-width:700px;margin:0 auto;padding:36px 24px 80px}
        .bz-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px}
        .bz-back{font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;padding:0;transition:color .2s;font-family:inherit}
        .bz-back:hover{color:var(--t-fg)}
        .bz-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:5px 14px;border-radius:99px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:#fbbf24}
        .bz-hero-h{font-size:clamp(1.8rem,4vw,2.6rem);font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:10px}
        .bz-hero-sub{font-size:14px;color:var(--t-muted);line-height:1.7;margin-bottom:32px}
        .bz-rules{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:36px}
        .bz-rule{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:14px;padding:18px 14px;text-align:center}
        .bz-rule-ico{font-size:22px;margin-bottom:8px}
        .bz-rule-val{font-size:18px;font-weight:900;color:var(--t-heading);margin-bottom:3px}
        .bz-rule-lbl{font-size:11px;color:var(--t-muted)}
        .bz-diff-row{display:flex;gap:8px;margin-bottom:28px}
        .bz-diff{flex:1;padding:10px;border-radius:10px;border:1px solid var(--t-border2);background:transparent;color:var(--t-muted);font-size:13px;font-weight:600;cursor:pointer;transition:all .2s;font-family:inherit}
        .bz-diff.active{border-color:rgba(245,158,11,.5);background:rgba(245,158,11,.08);color:#fbbf24}
        .bz-deck-row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:20px}
        .bz-deck{padding:10px 8px;border-radius:10px;border:1px solid var(--t-border2);background:transparent;color:var(--t-muted);font-size:12px;font-weight:700;cursor:pointer;transition:all .2s;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:5px}
        .bz-deck.active{border-color:rgba(96,165,250,.45);background:rgba(96,165,250,.08);color:#93c5fd}
        .bz-start{width:100%;padding:16px;border-radius:13px;border:none;background:linear-gradient(135deg,#b89531,#d4aa3f);color:#000;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 0 20px rgba(184,149,49,.35);transition:all .25s}
        .bz-start:hover{transform:translateY(-2px);box-shadow:0 6px 28px rgba(184,149,49,.5)}
        .bz-game-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
        .bz-prog-txt{font-size:13px;font-weight:700;color:var(--t-muted)}.bz-prog-txt span{color:var(--t-heading)}
        .bz-timer-wrap{position:relative;width:90px;height:90px;margin:0 auto 24px;flex-shrink:0}
        .bz-timer-wrap svg{position:absolute;inset:0;transform:rotate(-90deg)}
        .bz-timer-center{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:900;color:var(--t-heading);font-variant-numeric:tabular-nums}
        .bz-timer-wrap.urgent .bz-timer-center{color:#ef4444}
        .bz-q-bar{height:4px;background:var(--t-bar-track);border-radius:99px;overflow:hidden;margin-bottom:28px}
        .bz-q-fill{height:100%;border-radius:99px;background:linear-gradient(90deg,#f59e0b,#fbbf24);transition:width .4s}
        .bz-q-card{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:20px;padding:28px;margin-bottom:16px;min-height:100px;display:flex;align-items:center}
        .bz-q-text{font-size:18px;font-weight:700;color:var(--t-heading);line-height:1.5}
        .bz-answer{width:100%;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:13px;padding:14px 16px;font-size:14px;color:var(--t-fg);font-family:inherit;resize:none;outline:none;min-height:110px;transition:border-color .2s;line-height:1.6}
        .bz-answer:focus{border-color:rgba(245,158,11,.4)}
        .bz-game-foot{display:flex;align-items:center;justify-content:space-between;margin-top:14px}
        .bz-live{display:flex;gap:16px;font-size:11px;color:var(--t-muted);font-weight:600}.bz-live span{color:var(--t-fg)}
        .bz-action-row{display:flex;gap:8px}
        .bz-skip{padding:10px 18px;border-radius:10px;border:1px solid var(--t-border2);background:transparent;color:var(--t-muted);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s}
        .bz-skip:hover{background:var(--t-surface-hover);color:var(--t-fg)}
        .bz-next{padding:10px 22px;border-radius:10px;border:none;background:rgba(245,158,11,.85);color:#000;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .2s}
        .bz-next:hover{background:#f59e0b}
        .bz-results-hero{text-align:center;margin-bottom:32px}
        .bz-big-score{font-size:4rem;font-weight:900;letter-spacing:-.04em;background:linear-gradient(135deg,#f59e0b,#fbbf24);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}
        .bz-results-title{font-size:20px;font-weight:800;color:var(--t-heading);margin:8px 0 4px}
        .bz-results-sub{font-size:13px;color:var(--t-muted)}
        .bz-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px}
        .bz-stat{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:14px;padding:16px;text-align:center}
        .bz-stat-big{font-size:22px;font-weight:900;color:var(--t-heading);margin-bottom:2px}
        .bz-stat-lbl{font-size:11px;color:var(--t-muted)}
        .bz-badge-row{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:24px}
        .bz-badge-item{padding:4px 12px;border-radius:99px;font-size:11px;font-weight:700;border:1px solid}
        .bz-qa-list{display:flex;flex-direction:column;gap:10px;margin-bottom:28px}
        .bz-qa-item{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:14px;padding:16px}
        .bz-qa-q{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--t-muted);margin-bottom:5px}
        .bz-qa-a{font-size:13px;color:var(--t-fg);line-height:1.6}
        .bz-qa-meta{font-size:10px;color:var(--t-muted);margin-top:6px}
        .bz-qa-flags{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}
        .bz-qa-flag{font-size:10px;font-weight:700;padding:2px 7px;border-radius:99px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.22);color:#fbbf24}
        .bz-cta-row{display:flex;gap:10px;justify-content:center}
        .bz-btn-primary{padding:12px 24px;border-radius:11px;border:none;background:linear-gradient(135deg,#b89531,#d4aa3f);color:#000;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 0 14px rgba(184,149,49,.3);transition:all .2s}
        .bz-btn-secondary{padding:12px 24px;border-radius:11px;border:1px solid var(--t-border2);background:transparent;color:var(--t-fg);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
        @keyframes bzFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .bz-screen{animation:bzFadeIn .3s ease}
        </style>`;

        let config = { total: 10, timePerQ: 60, deck: 'general' };
        let gs = { qi: 0, questions: [], answers: [], timeLeft: 60, timer: null, startTime: 0 };

        mainContent.innerHTML = CSS + `
        <div class="bz-wrap">
            <div class="bz-orbs"><div class="bz-orb bz-orb1"></div><div class="bz-orb bz-orb2"></div></div>
            <div class="bz-page">
                <div class="bz-top">
                    <button class="bz-back" onclick="window.nav('games')">${ti('arrow-left')} Back to Games</button>
                    <div class="bz-badge">${ti('bolt')} 60-Second Blitz</div>
                </div>
                <div id="bz-intro" class="bz-screen">
                    <div class="bz-hero-h">Think fast. Answer faster.</div>
                    <div class="bz-hero-sub">10 real interview questions. 60 seconds each. No second-guessing. Train your brain to produce clear, concise answers under pressure.</div>
                    <div class="bz-rules">
                        <div class="bz-rule"><div class="bz-rule-ico">${ti('help-circle')}</div><div class="bz-rule-val" id="bz-q-count">10</div><div class="bz-rule-lbl">Questions</div></div>
                        <div class="bz-rule"><div class="bz-rule-ico">${ti('clock')}</div><div class="bz-rule-val" id="bz-t-count">60s</div><div class="bz-rule-lbl">Per question</div></div>
                        <div class="bz-rule"><div class="bz-rule-ico">${ti('chart-bar')}</div><div class="bz-rule-val">Live</div><div class="bz-rule-lbl">Word count</div></div>
                    </div>
                    <div style="font-size:12px;font-weight:700;color:var(--t-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">Prompt Deck</div>
                    <div class="bz-deck-row">
                        <button class="bz-deck active" id="bz-deck-general" onclick="bzSetDeck('general')">${ti('messages')} General</button>
                        <button class="bz-deck" id="bz-deck-behavioral" onclick="bzSetDeck('behavioral')">${ti('users')} Behavioral</button>
                        <button class="bz-deck" id="bz-deck-rolefit" onclick="bzSetDeck('rolefit')">${ti('briefcase')} Role-fit</button>
                        <button class="bz-deck" id="bz-deck-weak" onclick="bzSetDeck('weak')">${ti('target-arrow')} Weak area</button>
                    </div>
                    <div style="font-size:12px;font-weight:700;color:var(--t-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px">Difficulty</div>
                    <div class="bz-diff-row">
                        <button class="bz-diff" id="bz-d-easy" onclick="bzSetDiff('easy',5,90)">${ti('circle')} Easy (5Q - 90s)</button>
                        <button class="bz-diff active" id="bz-d-medium" onclick="bzSetDiff('medium',10,60)">${ti('circle-dot')} Medium (10Q - 60s)</button>
                        <button class="bz-diff" id="bz-d-hard" onclick="bzSetDiff('hard',10,30)">${ti('circle-filled')} Hard (10Q - 30s)</button>
                    </div>
                    <button class="bz-start" onclick="bzStart()">${ti('bolt')} Start Blitz</button>
                </div>
                <div id="bz-game" style="display:none" class="bz-screen">
                    <div class="bz-game-hdr">
                        <div class="bz-prog-txt">Question <span id="bz-q-num">1</span> of <span id="bz-q-total">10</span></div>
                        <div class="bz-timer-wrap" id="bz-timer-wrap">
                            <svg viewBox="0 0 90 90"><circle cx="45" cy="45" r="38" fill="none" stroke="var(--t-border)" stroke-width="7"/><circle cx="45" cy="45" r="38" fill="none" id="bz-timer-arc" stroke-width="7" stroke-linecap="round" stroke-dasharray="238.8" stroke-dashoffset="0" style="stroke:#f59e0b;transition:stroke-dashoffset .1s linear"/></svg>
                            <div class="bz-timer-center" id="bz-timer-display">60</div>
                        </div>
                    </div>
                    <div class="bz-q-bar"><div class="bz-q-fill" id="bz-q-fill" style="width:10%"></div></div>
                    <div class="bz-q-card"><div class="bz-q-text" id="bz-question">Loading...</div></div>
                    <textarea class="bz-answer" id="bz-answer" placeholder="Type your answer here..."></textarea>
                    <div class="bz-game-foot">
                        <div class="bz-live"><div>Words: <span id="bz-wc">0</span></div><div>Pace: <span id="bz-pace">-</span></div></div>
                        <div class="bz-action-row"><button class="bz-skip" onclick="bzSkip()">Skip</button><button class="bz-next" onclick="bzNext()">Next ${ti('arrow-right')}</button></div>
                    </div>
                </div>
                <div id="bz-results" style="display:none" class="bz-screen"></div>
            </div>
        </div>`;

        // Live word count
        document.getElementById('bz-answer').addEventListener('input', () => {
            const val = document.getElementById('bz-answer').value;
            const wc = val.trim() ? val.trim().split(/\s+/).length : 0;
            document.getElementById('bz-wc').textContent = wc;
            const elapsed = Math.max(1, (Date.now() - gs.startTime) / 1000);
            document.getElementById('bz-pace').textContent = Math.round(wc / elapsed * 60) + ' wpm';
        });

        window.bzSetDiff = (d, q, t) => {
            document.querySelectorAll('.bz-diff').forEach(b => b.classList.remove('active'));
            document.getElementById('bz-d-' + d).classList.add('active');
            config = { ...config, total: q, timePerQ: t };
            document.getElementById('bz-q-count').textContent = q;
            document.getElementById('bz-t-count').textContent = t + 's';
        };

        window.bzSetDeck = (deck) => {
            document.querySelectorAll('.bz-deck').forEach(b => b.classList.remove('active'));
            document.getElementById('bz-deck-' + deck)?.classList.add('active');
            config = { ...config, deck };
        };

        window.bzStart = () => {
            const shuffled = [...getBlitzDeck(config.deck)].sort(() => Math.random() - .5).slice(0, config.total);
            gs = { qi: 0, questions: shuffled, answers: Array(config.total).fill(null).map(() => ({ text: '', wc: 0, timeUsed: 0, skipped: false })), timeLeft: config.timePerQ, timer: null, startTime: 0 };
            bzRenderQ();
            bzShow('bz-game');
        };

        function bzRenderQ() {
            document.getElementById('bz-question').textContent = gs.questions[gs.qi];
            document.getElementById('bz-answer').value = '';
            document.getElementById('bz-q-num').textContent = gs.qi + 1;
            document.getElementById('bz-q-total').textContent = config.total;
            document.getElementById('bz-q-fill').style.width = ((gs.qi + 1) / config.total * 100) + '%';
            document.getElementById('bz-wc').textContent = 0;
            document.getElementById('bz-pace').textContent = '-';
            gs.timeLeft = config.timePerQ;
            gs.startTime = Date.now();
            clearInterval(gs.timer);
            document.getElementById('bz-timer-wrap').classList.remove('urgent');
            gs.timer = setInterval(bzTick, 100);
            bzUpdateTimer();
            document.getElementById('bz-answer').focus();
        }

        function bzTick() {
            const elapsed = (Date.now() - gs.startTime) / 1000;
            gs.timeLeft = Math.max(0, config.timePerQ - elapsed);
            bzUpdateTimer();
            if (gs.timeLeft <= 10) document.getElementById('bz-timer-wrap').classList.add('urgent');
            if (gs.timeLeft <= 0) { clearInterval(gs.timer); bzNext(true); }
        }

        function bzUpdateTimer() {
            const t = Math.ceil(gs.timeLeft);
            const circ = 2 * Math.PI * 38;
            const arc = document.getElementById('bz-timer-arc');
            document.getElementById('bz-timer-display').textContent = t;
            arc.style.strokeDashoffset = circ * (1 - gs.timeLeft / config.timePerQ);
            const u = gs.timeLeft / config.timePerQ;
            arc.style.stroke = u > .5 ? '#f59e0b' : u > .25 ? '#f97316' : '#ef4444';
        }

        window.bzSkip = () => {
            const a = gs.answers[gs.qi];
            a.skipped = true; a.text = ''; a.wc = 0; a.timeUsed = config.timePerQ - gs.timeLeft;
            bzAdvance();
        };

        window.bzNext = (auto = false) => {
            clearInterval(gs.timer);
            const val = document.getElementById('bz-answer').value;
            const wc = val.trim() ? val.trim().split(/\s+/).length : 0;
            const a = gs.answers[gs.qi];
            a.text = val; a.wc = wc; a.timeUsed = config.timePerQ - gs.timeLeft; a.skipped = false;
            bzAdvance();
        };

        function bzAdvance() {
            clearInterval(gs.timer);
            gs.qi++;
            if (gs.qi >= config.total) bzShowResults();
            else bzRenderQ();
        }

        function bzShowResults() {
            const answered = gs.answers.filter(a => !a.skipped && a.wc > 0);
            const avgWC = answered.length ? Math.round(answered.reduce((s, a) => s + a.wc, 0) / answered.length) : 0;
            const avgWPM = answered.length ? Math.round(answered.reduce((s, a) => s + (a.wc / Math.max(1, a.timeUsed) * 60), 0) / answered.length) : 0;
            const reviews = gs.questions.map((q, i) => scoreBlitzAnswer(q, gs.answers[i].text, gs.answers[i].skipped, gs.answers[i].timeUsed, config.timePerQ));
            const completionScore = clampScore(answered.length / config.total * 100);
            const answerScore = reviews.length ? averageScore(reviews.map(r => r.score)) : 0;
            const score = averageScore([completionScore, answerScore, answerScore, answerScore]);
            const grade = score >= 85 ? 'Blitz Master' : score >= 70 ? 'Quick Thinker' : score >= 55 ? 'Getting There' : 'Keep Practicing';
            const gradeDesc = score >= 85 ? 'Outstanding! Clear and quick under pressure.' : score >= 70 ? 'Solid. Try slightly more detailed answers.' : score >= 55 ? 'Good effort. Skip fewer and add more detail.' : 'Keep at it. Aim for 30+ words per answer.';
            const competencyScores = {
                answer_relevance: averageScore(reviews.map(r => r.competency_scores.answer_relevance)),
                specificity: averageScore(reviews.map(r => r.competency_scores.specificity)),
                communication_clarity: averageScore(reviews.map(r => r.competency_scores.communication_clarity)),
                adaptability: averageScore(reviews.map(r => r.competency_scores.adaptability)),
            };
            updateMinigameBest('blitz', { score });
            saveMinigameRun({
                game: 'blitz',
                score,
                competency_scores: competencyScores,
                summary: `${answered.length}/${config.total} answered. ${gradeDesc}`,
                strengths: reviews.filter(r => r.score >= 80).slice(0, 3).map(r => r.summary),
                improvements: reviews.filter(r => r.score < 70).slice(0, 3).map(r => r.suggested),
                raw: { config, avgWC, avgWPM, reviews, answers: gs.answers },
            });

            const badges = [];
            if (answered.length === config.total) badges.push({ c: '#22c55e', t: `${ti('check')} Zero Skips` });
            if (avgWC >= 60) badges.push({ c: '#60a5fa', t: `${ti('text-size')} Detailed` });
            if (avgWPM >= 100) badges.push({ c: '#a78bfa', t: `${ti('bolt')} Speed Talker` });
            if (score >= 85) badges.push({ c: '#fbbf24', t: `${ti('trophy')} Top Performer` });

            document.getElementById('bz-results').innerHTML = `
                <div class="bz-results-hero">
                    <div class="bz-big-score">${score}</div>
                    <div class="bz-results-title">${grade}</div>
                    <div class="bz-results-sub">${gradeDesc}</div>
                </div>
                <div class="bz-stats">
                    <div class="bz-stat"><div class="bz-stat-big">${avgWC}</div><div class="bz-stat-lbl">Avg words</div></div>
                    <div class="bz-stat"><div class="bz-stat-big">${answered.length}/${config.total}</div><div class="bz-stat-lbl">Answered</div></div>
                    <div class="bz-stat"><div class="bz-stat-big">${avgWPM} wpm</div><div class="bz-stat-lbl">Avg pace</div></div>
                </div>
                <div class="bz-badge-row">${badges.map(b => `<span class="bz-badge-item" style="color:${b.c};border-color:${b.c}30;background:${b.c}12">${b.t}</span>`).join('')}</div>
                <div class="bz-qa-list">${gs.questions.map((q, i) => {
                const a = gs.answers[i];
                const r = reviews[i];
                const preview = a.text ? escapeHTML(a.text.length > 240 ? a.text.slice(0, 240) + '...' : a.text) : '<span style="color:var(--t-muted)">No answer captured.</span>';
                return `<div class="bz-qa-item">
                    <div class="bz-qa-q">${i + 1}. ${escapeHTML(q.length > 74 ? q.slice(0, 74) + '...' : q)}</div>
                    <div class="bz-qa-a">${preview}</div>
                    <div class="bz-qa-meta">Score: ${r.score}/100 - ${escapeHTML(r.summary)}</div>
                    ${r.flags.length ? `<div class="bz-qa-flags">${r.flags.map(f => `<span class="bz-qa-flag">${escapeHTML(f)}</span>`).join('')}</div>` : ''}
                </div>`;
            }).join('')}</div>
                <div class="bz-cta-row">
                    <button class="bz-btn-primary" onclick="bzStart()">Play again</button>
                    <button class="bz-btn-secondary" onclick="window.nav('games')">${ti('arrow-left')} Back to Games</button>
                </div>`;
            bzShow('bz-results');
        }

        function bzShow(id) {
            ['bz-intro', 'bz-game', 'bz-results'].forEach(s => { document.getElementById(s).style.display = s === id ? 'block' : 'none'; });
        }
    }

    // --- STAR BUILDER ---------------------------------------
    function renderGame_STAR() {
        const SCENARIOS = [
            { icon: 'bolt', name: 'Conflict', desc: 'Disagreement with teammate or stakeholder', q: 'Tell me about a time you had to navigate a high-stakes conflict between two stakeholders with opposing views.' },
            { icon: 'trophy', name: 'Achievement', desc: 'Your proudest professional win', q: 'Describe your most impactful professional achievement and the role you played in making it happen.' },
            { icon: 'trending-down', name: 'Failure', desc: 'Something that went wrong', q: 'Tell me about a time you made a significant mistake. What happened and what did you take from it?' },
            { icon: 'crown', name: 'Leadership', desc: 'Leading without authority', q: 'Describe a situation where you had to lead a team through an ambiguous or high-pressure situation.' },
            { icon: 'users', name: 'Teamwork', desc: 'Collaborating under difficulty', q: 'Tell me about a time you had to work closely with someone whose style was very different from yours.' },
            { icon: 'clock', name: 'Time Pressure', desc: 'Tight deadline delivery', q: 'Describe a situation where you had to deliver a complex project under an extremely tight deadline.' },
            { icon: 'puzzle', name: 'Ambiguity', desc: 'Incomplete information decisions', q: "Tell me about a time you had to make an important decision when you didn't have all the information." },
            { icon: 'message', name: 'Feedback', desc: 'Giving or receiving difficult feedback', q: 'Describe a situation where you had to give difficult feedback to someone. How did you approach it?' },
        ];
        const BUCKETS = [
            { id: 's', letter: 'S', name: 'Situation', col: '#7c3aed', hint: 'Set the scene in 2-3 sentences. Context, people, stakes. Aim for 20-50 words.', ideal: [20, 50] },
            { id: 't', letter: 'T', name: 'Task', col: '#2563eb', hint: 'What was YOUR specific responsibility? Use "I" not "we". 15-40 words.', ideal: [15, 40] },
            { id: 'a', letter: 'A', name: 'Action', col: '#059669', hint: 'Walk through what YOU did, step by step. Strong verbs. 50-100 words.', ideal: [50, 100] },
            { id: 'r', letter: 'R', name: 'Result', col: '#d97706', hint: 'What changed? Include a number or concrete outcome. 20-50 words.', ideal: [20, 50] },
        ];

        function scoreSTARSection(bucket, text) {
            const signals = scoreTextSignals(text);
            const [min, max] = bucket.ideal;
            const lengthScore = signals.word_count < 5 ? 20 : signals.word_count < min ? 55 : signals.word_count <= max ? 95 : signals.word_count <= max + 35 ? 76 : 58;
            const contentScore = bucket.id === 's'
                ? clampScore(lengthScore * .45 + signals.specificity_score * .35 + (signals.has_constraint ? 20 : 0))
                : bucket.id === 't'
                    ? clampScore(lengthScore * .35 + (signals.has_first_person ? 35 : 8) + (signals.has_constraint ? 15 : 0) + (signals.has_action_verb ? 15 : 0))
                    : bucket.id === 'a'
                        ? clampScore(lengthScore * .3 + Math.min(signals.action_verb_count, 4) * 13 + (signals.has_first_person ? 18 : 0) + signals.specificity_score * .25)
                        : clampScore(lengthScore * .3 + (signals.has_metric ? 32 : 5) + (signals.has_outcome ? 30 : 8) + signals.specificity_score * .25);
            return { score: clampScore(contentScore), length_score: lengthScore, signals };
        }

        function buildSTARReview(answers, question) {
            const sections = BUCKETS.map(bucket => ({ bucket, text: answers[bucket.id] || '', ...scoreSTARSection(bucket, answers[bucket.id] || '') }));
            const sectionScores = Object.fromEntries(sections.map(s => [s.bucket.id, s.score]));
            const wordCounts = Object.fromEntries(sections.map(s => [s.bucket.id, s.signals.word_count]));
            const allComplete = sections.every(s => s.signals.word_count >= 5);
            const actionIsLargest = wordCounts.a >= Math.max(wordCounts.s, wordCounts.t, wordCounts.r);
            const totalWords = sections.reduce((sum, s) => sum + s.signals.word_count, 0);
            const balanceScore = clampScore((allComplete ? 55 : 25) + (actionIsLargest ? 25 : 5) + (totalWords >= 90 && totalWords <= 220 ? 20 : totalWords >= 60 ? 12 : 0));
            const combinedSignals = scoreTextSignals(Object.values(answers).join(' '));
            const resultSignals = sections.find(s => s.bucket.id === 'r').signals;
            const taskSignals = sections.find(s => s.bucket.id === 't').signals;
            const actionSignals = sections.find(s => s.bucket.id === 'a').signals;
            const competencyScores = {
                structure: averageScore([balanceScore, ...sections.map(s => s.score)]),
                specificity: averageScore(sections.map(s => s.signals.specificity_score)),
                evidence_quality: clampScore((resultSignals.has_metric ? 35 : 8) + (resultSignals.has_outcome ? 30 : 10) + Math.min(combinedSignals.metric_count, 3) * 10 + (combinedSignals.has_constraint ? 10 : 0)),
                ownership: clampScore((taskSignals.has_first_person ? 35 : 10) + (actionSignals.has_first_person ? 25 : 8) + Math.min(actionSignals.action_verb_count, 5) * 8),
                communication_clarity: averageScore(sections.map(s => s.signals.clarity_score)),
            };
            const total = averageScore(Object.values(competencyScores));
            const warnings = [];
            if (!allComplete) warnings.push('Complete every STAR section with at least one concrete sentence.');
            if (!actionIsLargest) warnings.push('Make Action the largest section so the answer shows what you personally did.');
            if (!resultSignals.has_metric) warnings.push('Add a metric, count, timeline, or before/after comparison to the Result.');
            if (!combinedSignals.has_constraint) warnings.push('Name the constraint, stake, or trade-off so the example feels real.');
            if (!taskSignals.has_first_person || !actionSignals.has_first_person) warnings.push('Use first-person ownership in Task and Action.');
            const strengths = [];
            if (competencyScores.structure >= 80) strengths.push('Clear STAR structure');
            if (competencyScores.evidence_quality >= 80) strengths.push('Evidence-backed result');
            if (competencyScores.ownership >= 80) strengths.push('Strong personal ownership');
            if (competencyScores.communication_clarity >= 80) strengths.push('Concise and readable answer');
            const improvements = warnings.length ? warnings.slice(0, 3) : ['Turn this into a 60-90 second spoken version and practice it twice.'];
            const rewritten = [
                answers.s || `In a relevant situation for "${question?.name || 'this scenario'}", the team faced a concrete constraint with visible stakes.`,
                answers.t || 'I was responsible for clarifying the goal, aligning the stakeholders, and owning the next step.',
                answers.a || 'I broke the problem into options, chose the highest-impact path, communicated trade-offs, and drove execution with clear follow-up.',
                answers.r || 'The result was a measurable improvement, a clearer decision, and a stronger process the team could reuse.'
            ].map(part => String(part).trim()).filter(Boolean).join(' ');
            const drill = warnings.length
                ? `Rewrite the weakest section first: ${warnings[0].replace(/\.$/, '')}.`
                : 'Now practice delivering this answer out loud in 75 seconds without reading it.';
            return {
                score: total,
                competency_scores: competencyScores,
                section_scores: sectionScores,
                warnings,
                strengths,
                improvements,
                rewritten_answer: rewritten,
                practice_drill: drill,
                summary: total >= 85 ? 'Strong STAR answer with clear structure and evidence.' : total >= 70 ? 'Good structure; tighten proof and ownership.' : 'Useful draft, but it needs more concrete evidence and clearer personal action.',
                raw: { word_counts: wordCounts, question: question?.q || '', sections: sections.map(s => ({ id: s.bucket.id, score: s.score, signals: s.signals })) },
            };
        }

        async function fetchSTARCoach(review, answers, question) {
            const box = document.getElementById('st-ai-note');
            if (!box) return;
            try {
                const res = await fetch('/api/minigames/coach', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        game: 'star',
                        payload: { question: question?.q || '', answers, deterministic_review: review }
                    })
                });
                const data = await res.json();
                if (!data.available || !data.coaching) {
                    box.innerHTML = `${ti('cpu')} Local AI coaching unavailable. Deterministic coaching is shown above.`;
                    return;
                }
                const coaching = data.coaching;
                box.innerHTML = `
                    <div class="st-ai-title">${ti('brain')} qwen2.5:7b Coaching</div>
                    ${coaching.summary ? `<div class="st-ai-copy">${escapeHTML(coaching.summary)}</div>` : ''}
                    ${Array.isArray(coaching.improvements) && coaching.improvements.length ? `<div class="st-ai-copy"><strong>Focus:</strong> ${coaching.improvements.map(escapeHTML).join('; ')}</div>` : ''}
                    ${coaching.rewritten_answer ? `<div class="st-rewrite">${escapeHTML(coaching.rewritten_answer)}</div>` : ''}
                    ${coaching.practice_drill ? `<div class="st-ai-copy"><strong>Drill:</strong> ${escapeHTML(coaching.practice_drill)}</div>` : ''}
                `;
            } catch (e) {
                box.innerHTML = `${ti('cpu')} Local AI coaching unavailable. Deterministic coaching is shown above.`;
            }
        }

        let currentStep = 0, answers = { s: '', t: '', a: '', r: '' }, selectedQ = null;

        const CSS = `<style>
        .st-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);font-family:'Inter',system-ui,sans-serif;color:var(--t-fg);overflow-y:auto}
        .st-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
        .st-orb{position:absolute;border-radius:50%;filter:blur(110px)}
        .st-orb1{width:600px;height:600px;background:hsla(270,70%,55%,.07);top:-200px;left:-150px;animation:mgd1 22s ease-in-out infinite}
        .st-orb2{width:500px;height:500px;background:hsla(38,80%,50%,.06);bottom:-120px;right:-100px;animation:mgd2 26s ease-in-out infinite}
        .st-page{position:relative;z-index:1;max-width:760px;margin:0 auto;padding:36px 24px 80px}
        .st-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px}
        .st-back{font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;padding:0;font-family:inherit;transition:color .2s}.st-back:hover{color:var(--t-fg)}
        .st-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:5px 14px;border-radius:99px;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.3);color:#a78bfa}
        .st-hero-h{font-size:clamp(1.8rem,3.5vw,2.4rem);font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:8px}
        .st-hero-sub{font-size:14px;color:var(--t-muted);margin-bottom:28px}
        .st-sc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(162px,1fr));gap:10px}
        .st-sc{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:16px;padding:18px 14px;cursor:pointer;transition:all .25s;text-align:left}
        .st-sc:hover{background:rgba(124,58,237,.08);border-color:rgba(124,58,237,.35);transform:translateY(-2px)}
        .st-sc-ico{font-size:24px;margin-bottom:8px}
        .st-sc-name{font-size:13px;font-weight:700;color:var(--t-heading);margin-bottom:3px}
        .st-sc-desc{font-size:11px;color:var(--t-muted);line-height:1.5}
        .st-step-bar{display:flex;align-items:center;gap:4px;margin-bottom:28px}
        .st-step-pill{flex:1;height:4px;border-radius:99px;background:var(--t-border);transition:background .4s}
        .st-step-pill.done{background:#7c3aed}.st-step-pill.active{background:rgba(124,58,237,.5)}
        .st-q-box{background:rgba(124,58,237,.06);border:1px solid rgba(124,58,237,.2);border-radius:16px;padding:20px;margin-bottom:24px}
        .st-q-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#a78bfa;margin-bottom:6px}
        .st-q-text{font-size:15px;font-weight:600;color:var(--t-heading);line-height:1.6}
        .st-bucket{background:var(--t-surface);border-radius:18px;padding:22px;border:2px solid var(--t-border);margin-bottom:16px}
        .st-bucket.active{border-color:rgba(124,58,237,.4)}
        .st-bkt-hdr{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}
        .st-bkt-tag{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
        .st-bkt-letter{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:900;color:var(--t-heading)}
        .st-bkt-hint{font-size:12px;color:var(--t-muted);line-height:1.5;margin-bottom:10px}
        .st-bkt-ta{width:100%;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:10px;padding:12px 14px;font-size:13px;color:var(--t-fg);font-family:inherit;resize:none;outline:none;transition:border-color .2s;line-height:1.6}
        .st-bkt-ta:focus{border-color:rgba(124,58,237,.4)}
        .st-bkt-foot{display:flex;align-items:center;justify-content:space-between;margin-top:8px}
        .st-wm{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--t-muted)}
        .st-wm-bar{width:80px;height:4px;background:var(--t-border);border-radius:99px;overflow:hidden}
        .st-wm-fill{height:100%;border-radius:99px;transition:width .3s,background .3s}
        .st-alerts{display:flex;gap:6px;flex-wrap:wrap}
        .st-alert{font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;border:1px solid}
        .st-alert-good{color:#4ade80;border-color:rgba(74,222,128,.3);background:rgba(74,222,128,.06)}
        .st-alert-warn{color:#fbbf24;border-color:rgba(251,191,36,.3);background:rgba(251,191,36,.06)}
        .st-nav-row{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
        .st-btn-ghost{padding:10px 20px;border-radius:10px;border:1px solid var(--t-border2);background:transparent;color:var(--t-muted);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;transition:all .2s}.st-btn-ghost:hover{background:var(--t-bar-track);color:var(--t-fg)}
        .st-btn-primary{padding:10px 24px;border-radius:10px;border:none;background:linear-gradient(135deg,#7c3aed,#6d28d9);color:#fff;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 0 16px rgba(124,58,237,.3);transition:all .2s}.st-btn-primary:hover{transform:translateY(-1px)}.st-btn-primary:disabled{opacity:.4;cursor:not-allowed}
        .st-asm-box{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:18px;padding:28px;margin-bottom:20px}
        .st-asm-text{font-size:14px;line-height:1.85;color:var(--t-fg)}
        .st-asm-text .s-c{color:#c4b5fd}.st-asm-text .t-c{color:#93c5fd}.st-asm-text .a-c{color:#6ee7b7}.st-asm-text .r-c{color:#fcd34d}
        .st-legend{display:flex;gap:14px;flex-wrap:wrap;margin-bottom:16px}
        .st-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:600;color:var(--t-muted)}
        .st-legend-dot{width:8px;height:8px;border-radius:50%}
        .st-score-hero{text-align:center;margin-bottom:32px}
        .st-score-ring{position:relative;width:130px;height:130px;margin:0 auto 16px}
        .st-score-ring svg{position:absolute;inset:0;transform:rotate(-90deg)}
        .st-score-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
        .st-score-num{font-size:34px;font-weight:900;color:var(--t-heading)}
        .st-score-label{font-size:10px;font-weight:700;color:var(--t-muted);letter-spacing:.07em;text-transform:uppercase}
        .st-score-title{font-size:22px;font-weight:800;color:var(--t-heading);margin-bottom:4px}
        .st-score-sub{font-size:13px;color:var(--t-muted)}
        .st-d-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:24px}
        .st-d-card{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:14px;padding:16px}
        .st-d-lbl{font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t-muted);margin-bottom:6px}
        .st-d-bar{height:6px;background:var(--t-border);border-radius:99px;overflow:hidden;margin-bottom:6px}
        .st-d-fill{height:100%;border-radius:99px;transition:width 1s ease}
        .st-review{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:16px;padding:20px;margin-bottom:18px}
        .st-review-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--t-muted);margin-bottom:12px;display:flex;align-items:center;gap:7px}
        .st-review-list{display:flex;flex-direction:column;gap:8px}
        .st-review-item{display:flex;gap:9px;font-size:12px;line-height:1.6;color:var(--t-fg)}
        .st-rewrite{font-size:12px;color:var(--t-fg);line-height:1.7;border-left:2px solid rgba(167,139,250,.45);background:rgba(124,58,237,.06);padding:10px 12px;border-radius:9px;margin-top:10px}
        .st-ai-note{background:rgba(96,165,250,.06);border:1px solid rgba(96,165,250,.22);border-radius:14px;padding:14px;margin-bottom:20px;font-size:12px;color:var(--t-muted);line-height:1.6}
        .st-ai-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:#93c5fd;margin-bottom:8px}
        .st-ai-copy{font-size:12px;color:var(--t-fg);line-height:1.7;margin-top:7px}
        .st-cta-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}
        @keyframes stFade{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        .st-screen{animation:stFade .3s ease}
        </style>`;

        mainContent.innerHTML = CSS + `
        <div class="st-wrap">
            <div class="st-orbs"><div class="st-orb st-orb1"></div><div class="st-orb st-orb2"></div></div>
            <div class="st-page">
                <div class="st-top">
                    <button class="st-back" onclick="window.nav('games')">${ti('arrow-left')} Back to Games</button>
                    <div class="st-badge">${ti('stars')} STAR Builder</div>
                </div>
                <div id="st-select" class="st-screen">
                    <div class="st-hero-h">Pick your scenario</div>
                    <div class="st-hero-sub">Choose the type of behavioral question you want to practice answering.</div>
                    <div class="st-sc-grid">${SCENARIOS.map((s, i) => `<div class="st-sc" onclick="stSelect(${i})"><div class="st-sc-ico">${ti(s.icon)}</div><div class="st-sc-name">${s.name}</div><div class="st-sc-desc">${s.desc}</div></div>`).join('')}</div>
                </div>
                <div id="st-build" style="display:none" class="st-screen">
                    <div class="st-step-bar"><div class="st-step-pill" id="st-sp0"></div><div class="st-step-pill" id="st-sp1"></div><div class="st-step-pill" id="st-sp2"></div><div class="st-step-pill" id="st-sp3"></div></div>
                    <div class="st-q-box"><div class="st-q-label">Your question</div><div class="st-q-text" id="st-q-text"></div></div>
                    <div id="st-bucket-area"></div>
                    <div class="st-nav-row"><button class="st-btn-ghost" onclick="stBack()">${ti('arrow-left')} Back</button><button class="st-btn-primary" id="st-next-btn" onclick="stNext()">Next ${ti('arrow-right')}</button></div>
                </div>
                <div id="st-assembly" style="display:none" class="st-screen">
                    <div class="st-hero-h" style="margin-bottom:6px">Your answer, assembled</div>
                    <div class="st-hero-sub">Each colour shows a different STAR component.</div>
                    <div class="st-legend"><span class="st-legend-item"><span class="st-legend-dot" style="background:#c4b5fd"></span>Situation</span><span class="st-legend-item"><span class="st-legend-dot" style="background:#93c5fd"></span>Task</span><span class="st-legend-item"><span class="st-legend-dot" style="background:#6ee7b7"></span>Action</span><span class="st-legend-item"><span class="st-legend-dot" style="background:#fcd34d"></span>Result</span></div>
                    <div class="st-asm-box"><div class="st-asm-text" id="st-asm-text"></div></div>
                    <div class="st-nav-row"><button class="st-btn-ghost" onclick="stBackToBuild()">${ti('arrow-left')} Edit</button><button class="st-btn-primary" onclick="stShowScore()">View Score ${ti('arrow-right')}</button></div>
                </div>
                <div id="st-score" style="display:none" class="st-screen">
                    <div class="st-score-hero">
                        <div class="st-score-ring"><svg viewBox="0 0 130 130"><circle cx="65" cy="65" r="55" fill="none" stroke="var(--t-border)" stroke-width="10"/><circle cx="65" cy="65" r="55" fill="none" id="st-score-arc" stroke-width="10" stroke-linecap="round" stroke-dasharray="345.6" stroke-dashoffset="345.6" style="transition:stroke-dashoffset 1.3s cubic-bezier(.4,0,.2,1)"/></svg>
                        <div class="st-score-center"><div class="st-score-num" id="st-score-num">0</div><div class="st-score-label">/ 100</div></div></div>
                        <div class="st-score-title" id="st-score-grade">Great Answer</div>
                        <div class="st-score-sub" id="st-score-sub">Your answer was well-structured and specific.</div>
                    </div>
                    <div class="st-d-grid" id="st-d-grid"></div>
                    <div id="st-review-area"></div>
                    <div class="st-ai-note" id="st-ai-note">${ti('loader-2')} Checking local qwen coaching...</div>
                    <div class="st-cta-row"><button class="st-btn-primary" onclick="stRestart()">Try another scenario</button><button class="st-btn-ghost" onclick="window.nav('games')">${ti('arrow-left')} Back to Games</button></div>
                </div>
            </div>
        </div>`;

        window.stSelect = (i) => { selectedQ = SCENARIOS[i]; answers = { s: '', t: '', a: '', r: '' }; currentStep = 0; document.getElementById('st-q-text').textContent = selectedQ.q; stShow('st-build'); stRenderBucket(0); stUpdateProgress(); };
        window.stBack = () => { if (currentStep > 0) { currentStep--; stUpdateProgress(); stRenderBucket(currentStep); } else stShow('st-select'); };
        window.stBackToBuild = () => { stShow('st-build'); stRenderBucket(currentStep); };
        window.stRestart = () => { stShow('st-select'); };

        window.stNext = () => {
            const b = BUCKETS[currentStep];
            answers[b.id] = document.getElementById('st-ta-' + b.id)?.value || '';
            if (currentStep < 3) { currentStep++; stUpdateProgress(); stRenderBucket(currentStep); }
            else { document.getElementById('st-asm-text').innerHTML = `<span class="s-c">${escapeHTML(answers.s)}</span> <span class="t-c">${escapeHTML(answers.t)}</span> <span class="a-c">${escapeHTML(answers.a)}</span> <span class="r-c">${escapeHTML(answers.r)}</span>`; stShow('st-assembly'); }
            document.getElementById('st-next-btn').innerHTML = currentStep === 3 ? `Build my answer ${ti('arrow-right')}` : `Next ${ti('arrow-right')}`;
        };

        function stUpdateProgress() { BUCKETS.forEach((_, i) => { const el = document.getElementById('st-sp' + i); el.className = 'st-step-pill' + (i < currentStep ? ' done' : i === currentStep ? ' active' : ''); }); }

        function stRenderBucket(idx) {
            const b = BUCKETS[idx];
            document.getElementById('st-bucket-area').innerHTML = `
            <div class="st-bucket active">
                <div class="st-bkt-hdr"><div class="st-bkt-tag"><div class="st-bkt-letter" style="background:${b.col}">${b.letter}</div><span style="color:${b.col}">${b.name}</span></div><div class="st-alerts" id="st-alerts-${b.id}"></div></div>
                <div class="st-bkt-hint">${b.hint}</div>
                <textarea class="st-bkt-ta" id="st-ta-${b.id}" rows="4" placeholder="Start writing your ${b.name.toLowerCase()}..." oninput="stOnInput('${b.id}',${idx})">${answers[b.id]}</textarea>
                <div class="st-bkt-foot">
                    <div class="st-wm"><div class="st-wm-bar"><div class="st-wm-fill" id="st-wf-${b.id}"></div></div><span id="st-wc-${b.id}">0 words</span></div>
                    <span style="font-size:11px;color:var(--t-muted)">Ideal: ${b.ideal[0]}-${b.ideal[1]} words</span>
                </div>
            </div>`;
            stOnInput(b.id, idx);
        }

        window.stOnInput = (id, idx) => {
            const b = BUCKETS[idx], ta = document.getElementById('st-ta-' + id);
            if (!ta) return;
            const val = ta.value; answers[id] = val;
            const wc = val.trim() ? val.trim().split(/\s+/).length : 0;
            const pct = Math.min(100, Math.round(wc / b.ideal[1] * 100));
            const fill = document.getElementById('st-wf-' + id);
            document.getElementById('st-wc-' + id).textContent = wc + ' words';
            fill.style.width = pct + '%';
            fill.style.background = wc < b.ideal[0] ? '#f59e0b' : wc <= b.ideal[1] ? '#22c55e' : '#ef4444';
            const alerts = [];
            if (wc >= b.ideal[0] && wc <= b.ideal[1]) alerts.push({ cls: 'st-alert-good', text: `${ti('check')} Ideal length` });
            else if (wc < b.ideal[0]) alerts.push({ cls: 'st-alert-warn', text: `${ti('alert-triangle')} Too short` });
            else alerts.push({ cls: 'st-alert-warn', text: `${ti('alert-triangle')} Too long` });
            if (id === 't' && val && !val.match(/\bI\b/)) alerts.push({ cls: 'st-alert-warn', text: `${ti('alert-triangle')} Use "I"` });
            if (id === 'a' && val.match(/\b(created|built|led|designed|negotiated|reduced|increased|fixed|managed|launched|implemented|wrote|analyzed|resolved|presented|delivered)\b/i)) alerts.push({ cls: 'st-alert-good', text: `${ti('check')} Strong verbs` });
            if (id === 'r') { if (val.match(/\d+/)) alerts.push({ cls: 'st-alert-good', text: `${ti('check')} Has metric` }); else if (wc > 5) alerts.push({ cls: 'st-alert-warn', text: `${ti('alert-triangle')} Add a number` }); }
            document.getElementById('st-alerts-' + id).innerHTML = alerts.map(a => `<span class="st-alert ${a.cls}">${a.text}</span>`).join('');
            document.getElementById('st-next-btn').disabled = wc < 5;
        };

        window.stShowScore = async () => {
            const review = buildSTARReview(answers, selectedQ);
            const dims = [
                { name: 'Structure', score: review.competency_scores.structure, col: '#a78bfa' },
                { name: 'Specificity', score: review.competency_scores.specificity, col: '#60a5fa' },
                { name: 'Evidence Quality', score: review.competency_scores.evidence_quality, col: '#fbbf24' },
                { name: 'Ownership', score: review.competency_scores.ownership, col: '#34d399' },
                { name: 'Clarity', score: review.competency_scores.communication_clarity, col: '#38bdf8' },
            ];
            const total = review.score;
            updateMinigameBest('star', { score: total });
            saveMinigameRun({
                game: 'star',
                score: total,
                competency_scores: review.competency_scores,
                summary: review.summary,
                strengths: review.strengths,
                improvements: review.improvements,
                raw: { ...review.raw, rewritten_answer: review.rewritten_answer, practice_drill: review.practice_drill },
            });
            const arc = document.getElementById('st-score-arc');
            const circ = 2 * Math.PI * 55;
            const grade = total >= 85 ? 'Excellent Answer' : total >= 70 ? 'Good Answer' : total >= 55 ? 'Needs Work' : 'Keep Practicing';
            const sub = review.summary;
            const arcCol = total >= 85 ? '#22c55e' : total >= 70 ? '#3b82f6' : total >= 55 ? '#f59e0b' : '#ef4444';
            arc.style.stroke = arcCol;
            document.getElementById('st-score-grade').textContent = grade;
            document.getElementById('st-score-sub').textContent = sub;
            document.getElementById('st-score-num').textContent = total;
            document.getElementById('st-d-grid').innerHTML = dims.map(d => `<div class="st-d-card"><div class="st-d-lbl">${escapeHTML(d.name)}</div><div class="st-d-bar"><div class="st-d-fill" style="width:0%;background:${d.col}" data-w="${d.score}%"></div></div><div style="display:flex;justify-content:space-between"><div style="font-size:13px;font-weight:700;color:#fff">${d.score >= 85 ? 'Excellent' : d.score >= 70 ? 'Good' : d.score >= 55 ? 'Fair' : 'Needs work'}</div><div style="font-size:12px;font-weight:600;color:var(--t-muted)">${d.score}/100</div></div></div>`).join('');
            document.getElementById('st-review-area').innerHTML = `
                <div class="st-review">
                    <div class="st-review-title">${ti('chart-bar')} Section Scores</div>
                    <div class="st-d-grid" style="margin-bottom:0">${BUCKETS.map(b => `<div class="st-d-card"><div class="st-d-lbl">${escapeHTML(b.name)}</div><div style="font-size:20px;font-weight:900;color:${b.col}">${review.section_scores[b.id] || 0}</div></div>`).join('')}</div>
                </div>
                <div class="st-review">
                    <div class="st-review-title">${ti(review.warnings.length ? 'alert-triangle' : 'circle-check')} Missing Elements</div>
                    <div class="st-review-list">${(review.warnings.length ? review.warnings : ['No major missing elements detected.']).map(item => `<div class="st-review-item"><span>${ti(review.warnings.length ? 'alert-triangle' : 'check')}</span><span>${escapeHTML(item)}</span></div>`).join('')}</div>
                </div>
                <div class="st-review">
                    <div class="st-review-title">${ti('wand')} Stronger Version</div>
                    <div class="st-rewrite">${escapeHTML(review.rewritten_answer)}</div>
                    <div class="st-review-item" style="margin-top:10px"><span>${ti('target-arrow')}</span><span>${escapeHTML(review.practice_drill)}</span></div>
                </div>
            `;
            stShow('st-score');
            setTimeout(() => { arc.style.strokeDashoffset = circ * (1 - total / 100); document.querySelectorAll('.st-d-fill').forEach(el => { el.style.width = el.dataset.w; }); }, 200);
            fetchSTARCoach(review, answers, selectedQ);
        };

        function stShow(id) { ['st-select', 'st-build', 'st-assembly', 'st-score'].forEach(s => { document.getElementById(s).style.display = s === id ? 'block' : 'none'; }); }
    }

    // --- SALARY DARE ----------------------------------------
    function renderGame_Salary() {
        const SCENARIOS = [
            { icon: 'device-desktop-code', name: 'Tech Lead - Series B Startup', role: 'Engineering Lead', them: 'Jordan Mills', avatar: 'tie', initial: 110000, max: 130000, benefits: 'Equity: 0.15% - Remote - $2k L&D', toughness: 0.5, openers: ["We're excited to extend you an offer of $110,000 base with 0.15% equity.", "I know the market is competitive - we've stretched to $110k at the top of our band."] },
            { icon: 'building-bank', name: 'Senior Analyst - Investment Bank', role: 'Strategy & Ops', them: 'Victoria Park', avatar: 'tie', initial: 95000, max: 110000, benefits: 'Bonus: 15-25% - Hybrid - Full benefits', toughness: 0.7, openers: ["After reviewing your background, we'd like to offer $95,000 plus a target bonus of 20%.", "Our compensation package sits at $95k base - well above our analyst band."] },
            { icon: 'world', name: 'Product Manager - FAANG', role: 'Product Management', them: 'Derek Watson', avatar: 'user-code', initial: 140000, max: 175000, benefits: 'RSU: $80k/yr - Hybrid - Unlimited PTO', toughness: 0.3, openers: ["We're excited to offer $140,000 base with $80,000 in annual RSUs.", "Our package reflects our valuation of your skills - $140k base."] },
            { icon: 'heart-pulse', name: 'Clinical Director - Healthcare', role: 'Operations', them: 'Dr. Anita Rao', avatar: 'stethoscope', initial: 125000, max: 145000, benefits: 'Pension: 12% - On-site - CPD budget', toughness: 0.65, openers: ["We'd like to bring you on at $125,000 - our band is fairly fixed.", "This offer is at the top of our approved range at $125k."] },
        ];

        let gS = {};

        function scoreSalaryReason(reason, ask, currentOffer, scenario) {
            const signals = scoreTextSignals(reason);
            const askGap = ask - currentOffer;
            const totalRoom = Math.max(1, scenario.max - scenario.initial);
            const askPressure = askGap / totalRoom;
            const tooLow = ask <= currentOffer;
            const tooHigh = ask > scenario.max * 1.18;
            const strategy = tooLow ? 20 : tooHigh ? 35 : askPressure <= .45 ? 88 : askPressure <= .85 ? 76 : 62;
            const evidenceQuality = clampScore(signals.specificity_score * .45 + (signals.has_metric ? 25 : 0) + (signals.has_outcome ? 18 : 0) + (signals.word_count >= 12 ? 12 : 0));
            const demanding = /\b(non-negotiable|must|deserve|obviously|ridiculous|insulting|take it or leave it)\b/i.test(reason);
            const professionalTone = clampScore(82 + (signals.word_count >= 10 ? 10 : -8) - (demanding ? 35 : 0) - Math.min(signals.filler_count * 4, 12));
            const score = averageScore([strategy, evidenceQuality, professionalTone]);
            const flags = [];
            if (signals.word_count < 10) flags.push('Thin justification');
            if (!signals.has_metric && !signals.has_outcome) flags.push('No evidence');
            if (tooHigh) flags.push('Aggressive ask');
            if (demanding) flags.push('Tone risk');
            return { score, strategy, evidence_quality: evidenceQuality, professional_tone: professionalTone, flags, signals, ask_pressure: askPressure };
        }

        const CSS = `<style>
        .sd-wrap{position:relative;min-height:100vh;background:var(--t-bg-solid);font-family:'Inter',system-ui,sans-serif;color:var(--t-fg);overflow-y:auto}
        .sd-orbs{pointer-events:none;position:fixed;inset:0;z-index:0;overflow:hidden}
        .sd-orb{position:absolute;border-radius:50%;filter:blur(100px)}
        .sd-orb1{width:600px;height:600px;background:hsla(150,70%,45%,.07);top:-200px;left:-150px;animation:mgd1 22s ease-in-out infinite}
        .sd-orb2{width:500px;height:500px;background:hsla(38,80%,50%,.07);bottom:-100px;right:-100px;animation:mgd2 26s ease-in-out infinite}
        .sd-page{position:relative;z-index:1;max-width:760px;margin:0 auto;padding:36px 24px 80px}
        .sd-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:32px}
        .sd-back{font-size:13px;font-weight:600;color:var(--t-muted);background:none;border:none;cursor:pointer;padding:0;font-family:inherit;transition:color .2s}.sd-back:hover{color:var(--t-fg)}
        .sd-badge{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:5px 14px;border-radius:99px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);color:#4ade80}
        .sd-hero-h{font-size:clamp(1.8rem,4vw,2.6rem);font-weight:900;letter-spacing:-.03em;color:var(--t-heading);margin-bottom:10px}
        .sd-hero-sub{font-size:14px;color:var(--t-muted);line-height:1.7;margin-bottom:28px}
        .sd-sc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:28px}
        .sd-sc{background:var(--t-surface);border:1.5px solid var(--t-border2);border-radius:16px;padding:18px;cursor:pointer;transition:all .25s}
        .sd-sc:hover,.sd-sc.sel{background:rgba(34,197,94,.06);border-color:rgba(34,197,94,.4)}
        .sd-sc-hdr{display:flex;align-items:center;gap:10px;margin-bottom:8px}
        .sd-sc-name{font-size:14px;font-weight:700;color:var(--t-heading)}
        .sd-sc-detail{font-size:11px;color:var(--t-muted);line-height:1.5}
        .sd-sc-offer{font-size:12px;font-weight:700;color:#4ade80;margin-top:6px}
        .sd-start{width:100%;padding:16px;border-radius:13px;border:none;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 0 20px rgba(16,185,129,.3);transition:all .25s}.sd-start:hover{transform:translateY(-2px)}
        .sd-personas{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;margin-bottom:20px}
        .sd-persona{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:16px;padding:16px;text-align:center}
        .sd-persona-av{width:48px;height:48px;border-radius:50%;margin:0 auto 8px;display:flex;align-items:center;justify-content:center;font-size:22px}
        .sd-persona-name{font-size:13px;font-weight:700;color:var(--t-heading)}.sd-persona-role{font-size:11px;color:var(--t-muted)}
        .sd-vs{width:36px;height:36px;border-radius:50%;border:1px solid var(--t-border2);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:var(--t-muted)}
        .sd-offer-bar{background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:16px;padding:18px 22px;margin-bottom:18px;display:flex;align-items:center;justify-content:space-between}
        .sd-offer-lbl{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:3px}
        .sd-offer-val{font-size:28px;font-weight:900;color:#4ade80;font-variant-numeric:tabular-nums}
        .sd-offer-meta{font-size:11px;color:var(--t-muted);margin-top:2px}
        .sd-round{padding:5px 14px;border-radius:99px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.25);font-size:11px;font-weight:700;color:#4ade80}
        .sd-chat{display:flex;flex-direction:column;gap:12px;min-height:200px;max-height:280px;overflow-y:auto;margin-bottom:16px;padding-right:4px;scrollbar-width:thin;scrollbar-color:var(--t-border) transparent}
        .sd-msg{display:flex;gap:10px;align-items:flex-start;animation:stFade .25s ease}
        .sd-msg.them{flex-direction:row}.sd-msg.you{flex-direction:row-reverse}
        .sd-msg-av{width:30px;height:30px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:14px}
        .sd-msg-bubble{max-width:78%;padding:10px 14px;font-size:13px;line-height:1.6;border-radius:4px 14px 14px 14px}
        .sd-msg.them .sd-msg-bubble{background:rgba(34,197,94,.07);border:1px solid rgba(34,197,94,.18);color:var(--t-fg)}
        .sd-msg.you .sd-msg-bubble{background:rgba(184,149,49,.07);border:1px solid rgba(184,149,49,.2);color:var(--t-fg);border-radius:14px 4px 14px 14px}
        .sd-typing{display:inline-flex;gap:4px;align-items:center;padding:4px 0}
        .sd-typing span{width:6px;height:6px;border-radius:50%;background:rgba(74,222,128,.4);animation:sdBounce .9s ease-in-out infinite}
        .sd-typing span:nth-child(2){animation-delay:.15s}.sd-typing span:nth-child(3){animation-delay:.3s}
        @keyframes sdBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}
        .sd-input-box{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:16px;padding:18px;margin-bottom:12px}
        .sd-input-lbl{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--t-muted);margin-bottom:10px}
        .sd-ci-wrap{display:flex;align-items:center;gap:10px;margin-bottom:12px}
        .sd-ci-prefix{font-size:18px;font-weight:800;color:var(--t-muted)}
        .sd-ci-input{flex:1;background:transparent;border:none;outline:none;font-size:24px;font-weight:900;color:var(--t-heading);font-family:inherit;font-variant-numeric:tabular-nums;width:100%}
        .sd-ci-hint{font-size:11px;color:var(--t-muted);margin-bottom:12px}
        .sd-reason{width:100%;background:var(--t-surface);border:1px solid var(--t-border2);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--t-fg);font-family:inherit;resize:none;outline:none;transition:border-color .2s;line-height:1.6}.sd-reason:focus{border-color:rgba(34,197,94,.4)}
        .sd-input-actions{display:flex;gap:8px;margin-top:12px;justify-content:flex-end}
        .sd-btn-accept{padding:10px 20px;border-radius:10px;border:1px solid rgba(34,197,94,.35);background:rgba(34,197,94,.08);color:#4ade80;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;transition:all .2s}.sd-btn-accept:hover{background:rgba(34,197,94,.14)}
        .sd-btn-counter{padding:10px 20px;border-radius:10px;border:none;background:rgba(34,197,94,.85);color:#000;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;transition:all .2s}.sd-btn-counter:hover{background:#10b981}
        .sd-hints{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px}
        .sd-hint{padding:4px 10px;border-radius:8px;background:var(--t-surface);border:1px solid var(--t-border2);font-size:11px;font-weight:600;color:var(--t-muted);cursor:pointer;transition:all .2s;font-family:inherit}.sd-hint:hover{background:var(--t-border);color:var(--t-fg)}
        .sd-outcome-hero{text-align:center;margin-bottom:32px}
        .sd-outcome-ico{font-size:52px;margin-bottom:12px}
        .sd-outcome-title{font-size:24px;font-weight:900;color:var(--t-heading);margin-bottom:6px}
        .sd-outcome-sub{font-size:14px;color:var(--t-muted);margin-bottom:24px}
        .sd-onum-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:24px}
        .sd-onum{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:14px;padding:16px;text-align:center}
        .sd-onum-val{font-size:22px;font-weight:900;color:var(--t-heading);margin-bottom:3px}
        .sd-onum-lbl{font-size:11px;color:var(--t-muted)}
        .sd-lessons{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:16px;padding:22px;margin-bottom:24px}
        .sd-lessons-title{font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--t-muted);margin-bottom:14px}
        .sd-lesson{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px;font-size:13px;color:var(--t-fg);line-height:1.6}
        .sd-score-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:22px}
        .sd-score-card{background:var(--t-surface);border:1px solid var(--t-border2);border-radius:12px;padding:12px;text-align:center}
        .sd-score-val{font-size:18px;font-weight:900;color:var(--t-heading);margin-bottom:3px}
        .sd-score-lbl{font-size:9px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--t-muted)}
        .sd-best-move{background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:14px;padding:14px;margin-bottom:16px;font-size:12px;color:var(--t-fg);line-height:1.6}
        @media(max-width:720px){.sd-score-grid{grid-template-columns:repeat(2,1fr)}}
        .sd-cta-row{display:flex;gap:10px;justify-content:center}
        .sd-btn-primary{padding:12px 24px;border-radius:11px;border:none;background:linear-gradient(135deg,#059669,#10b981);color:#fff;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;box-shadow:0 0 14px rgba(16,185,129,.25);transition:all .2s}
        .sd-btn-secondary{padding:12px 24px;border-radius:11px;border:1px solid var(--t-border2);background:transparent;color:var(--t-fg);font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
        </style>`;

        mainContent.innerHTML = CSS + `
        <div class="sd-wrap">
            <div class="sd-orbs"><div class="sd-orb sd-orb1"></div><div class="sd-orb sd-orb2"></div></div>
            <div class="sd-page">
                <div class="sd-top"><button class="sd-back" onclick="window.nav('games')">${ti('arrow-left')} Back to Games</button><div class="sd-badge">${ti('cash-banknote')} Salary Dare</div></div>
                <div id="sd-intro" class="st-screen">
                    <div class="sd-hero-h">Know your worth. <span style="color:#4ade80">Prove it.</span></div>
                    <div class="sd-hero-sub">The offer is on the table. You have 5 rounds to negotiate the best deal you can.</div>
                    <div style="font-size:12px;font-weight:700;color:var(--t-muted);letter-spacing:.06em;text-transform:uppercase;margin-bottom:10px">Pick your scenario</div>
                    <div class="sd-sc-grid">${SCENARIOS.map((s, i) => `<div class="sd-sc" id="sd-sc-${i}" onclick="sdSelectSc(${i})"><div class="sd-sc-hdr">${ti(s.icon)}<span class="sd-sc-name">${s.name}</span></div><div class="sd-sc-detail">Role: <strong style="color:var(--t-fg)">${s.role}</strong></div><div class="sd-sc-offer">Initial: $${s.initial.toLocaleString()}</div></div>`).join('')}</div>
                    <button class="sd-start" onclick="sdStart()">${ti('player-play')} Accept the Challenge</button>
                </div>
                <div id="sd-game" style="display:none" class="st-screen">
                    <div class="sd-personas">
                        <div class="sd-persona"><div class="sd-persona-av" style="background:rgba(124,58,237,.15)" id="sd-them-av">${ti('tie')}</div><div class="sd-persona-name" id="sd-them-name">-</div><div class="sd-persona-role">Hiring Manager</div></div>
                        <div class="sd-vs">vs</div>
                        <div class="sd-persona"><div class="sd-persona-av" style="background:rgba(184,149,49,.12)">${ti('user')}</div><div class="sd-persona-name">You</div><div class="sd-persona-role">Candidate</div></div>
                    </div>
                    <div class="sd-offer-bar"><div><div class="sd-offer-lbl">Current offer</div><div class="sd-offer-val" id="sd-offer-val">$0</div><div class="sd-offer-meta" id="sd-offer-meta">-</div></div><div class="sd-round" id="sd-round-badge">Round 1 / 5</div></div>
                    <div class="sd-chat" id="sd-chat"></div>
                    <div class="sd-input-box" id="sd-input-box">
                        <div class="sd-input-lbl">Your Counter-Offer</div>
                        <div class="sd-hints" id="sd-hints"></div>
                        <div class="sd-ci-wrap"><div class="sd-ci-prefix">$</div><input class="sd-ci-input" type="number" id="sd-counter" placeholder="120,000" min="0" step="1000"></div>
                        <div class="sd-ci-hint" id="sd-ci-hint">Enter your desired base salary and justify below.</div>
                        <textarea class="sd-reason" id="sd-reason" rows="2" placeholder="Explain why you deserve this..."></textarea>
                        <div class="sd-input-actions"><button class="sd-btn-accept" onclick="sdAccept()">${ti('check')} Accept offer</button><button class="sd-btn-counter" onclick="sdCounter()">Counter ${ti('arrow-right')}</button></div>
                    </div>
                </div>
                <div id="sd-outcome" style="display:none" class="st-screen"></div>
            </div>
        </div>`;

        window.sdSelectSc = (i) => { document.querySelectorAll('.sd-sc').forEach(c => c.classList.remove('sel')); document.getElementById('sd-sc-' + i).classList.add('sel'); gS.scenarioIdx = i; };

        window.sdStart = () => {
            if (gS.scenarioIdx === undefined) sdSelectSc(0);
            const sc = SCENARIOS[gS.scenarioIdx];
            gS = { sc, round: 1, maxRounds: 5, currentOffer: sc.initial, lastUserOffer: 0, scenarioIdx: gS.scenarioIdx, moves: [], aggressiveCount: 0, relationship: 82 };
            document.getElementById('sd-them-av').innerHTML = ti(sc.avatar);
            document.getElementById('sd-them-name').textContent = sc.them;
            sdUpdateOffer();
            document.getElementById('sd-chat').innerHTML = '';
            sdAddMsg('them', sc.openers[Math.floor(Math.random() * sc.openers.length)]);
            sdUpdateHints();
            sdShow('sd-game');
        };

        function sdAddMsg(who, text) {
            const cl = document.getElementById('sd-chat');
            const el = document.createElement('div');
            el.className = 'sd-msg ' + who;
            const av = who === 'them' ? `<div class="sd-msg-av">${ti(gS.sc.avatar)}</div>` : `<div class="sd-msg-av">${ti('user')}</div>`;
            el.innerHTML = av + `<div class="sd-msg-bubble">${escapeHTML(text)}</div>`;
            cl.appendChild(el); cl.scrollTop = cl.scrollHeight;
        }

        function sdShowTyping() {
            const cl = document.getElementById('sd-chat');
            const el = document.createElement('div');
            el.className = 'sd-msg them'; el.id = 'sd-typing';
            el.innerHTML = `<div class="sd-msg-av">${ti(gS.sc.avatar)}</div><div class="sd-msg-bubble"><div class="sd-typing"><span></span><span></span><span></span></div></div>`;
            cl.appendChild(el); cl.scrollTop = cl.scrollHeight;
        }
        function sdRemoveTyping() { const t = document.getElementById('sd-typing'); if (t) t.remove(); }

        function sdUpdateOffer() {
            document.getElementById('sd-offer-val').textContent = '$' + gS.currentOffer.toLocaleString();
            document.getElementById('sd-offer-meta').textContent = gS.sc.benefits;
            document.getElementById('sd-round-badge').textContent = 'Round ' + gS.round + ' / ' + gS.maxRounds;
        }

        function sdUpdateHints() {
            const market = gS.sc.initial + Math.round((gS.sc.max - gS.sc.initial) * 0.5);
            const aggressive = gS.sc.max;
            const moderate = gS.sc.initial + Math.round((gS.sc.max - gS.sc.initial) * 0.3);
            document.getElementById('sd-hints').innerHTML = [
                { lbl: 'Moderate +' + Math.round((moderate - gS.currentOffer) / 1000) + 'k', v: moderate },
                { lbl: 'Market rate', v: market },
                { lbl: 'Aggressive', v: aggressive },
            ].map(h => `<button class="sd-hint" onclick="document.getElementById('sd-counter').value=${h.v}">${ti('bulb')} ${h.lbl}: $${h.v.toLocaleString()}</button>`).join('');
        }

        window.sdCounter = () => {
            const raw = parseInt(document.getElementById('sd-counter').value) || 0;
            const reason = document.getElementById('sd-reason').value.trim();
            if (!raw) { document.getElementById('sd-ci-hint').style.color = '#ef4444'; document.getElementById('sd-ci-hint').textContent = 'Please enter a counter-offer amount.'; return; }
            const reasonReview = scoreSalaryReason(reason, raw, gS.currentOffer, gS.sc);
            gS.moves.push({ round: gS.round, ask: raw, reason, review: reasonReview });
            if (reasonReview.flags.includes('Aggressive ask')) gS.aggressiveCount++;
            gS.relationship = clampScore(gS.relationship + (reasonReview.professional_tone >= 80 ? 5 : reasonReview.professional_tone < 55 ? -14 : -3) + (reasonReview.evidence_quality >= 75 ? 6 : 0));
            document.getElementById('sd-ci-hint').style.color = ''; document.getElementById('sd-ci-hint').textContent = 'Enter your desired base salary and justify below.';
            gS.lastUserOffer = raw;
            sdAddMsg('you', `Based on my research${reason ? ', ' + reason : ''}, I'm looking for $${raw.toLocaleString()} base.`);
            document.getElementById('sd-input-box').style.opacity = '.4';
            document.getElementById('sd-input-box').style.pointerEvents = 'none';
            sdShowTyping();
            setTimeout(() => { sdRemoveTyping(); sdAiRespond(raw, reasonReview); }, 1800);
        };

        window.sdAccept = () => {
            sdAddMsg('you', `I'd like to accept the current offer of $${gS.currentOffer.toLocaleString()}.`);
            document.getElementById('sd-input-box').style.opacity = '.4';
            document.getElementById('sd-input-box').style.pointerEvents = 'none';
            sdShowTyping();
            setTimeout(() => { sdRemoveTyping(); sdAddMsg('them', 'Wonderful! Welcome aboard!'); setTimeout(() => sdEndGame('accepted', gS.currentOffer), 1000); }, 1200);
        };

        function sdAiRespond(userAsk, reasonReview) {
            const sc = gS.sc, gap = userAsk - gS.currentOffer, maxGap = sc.max - sc.initial, roundsLeft = gS.maxRounds - gS.round;
            if (userAsk <= gS.currentOffer) { sdAddMsg('them', `That's actually less than our offer. We'll keep it at $${gS.currentOffer.toLocaleString()}.`); sdEndGame('accepted', gS.currentOffer); return; }
            if (gS.aggressiveCount >= 2 && reasonReview.score < 55) {
                sdAddMsg('them', `I don't think we're aligned on compensation expectations. We'll need to pause here at $${gS.currentOffer.toLocaleString()}.`);
                sdEndGame('stuck', gS.currentOffer);
                return;
            }
            if (userAsk > sc.max * 1.25) {
                sdAddMsg('them', `$${userAsk.toLocaleString()} is well beyond our range. Would you reconsider closer to our band?`);
                gS.relationship = clampScore(gS.relationship - 12);
                document.getElementById('sd-input-box').style.opacity = ''; document.getElementById('sd-input-box').style.pointerEvents = '';
                gS.round++; if (gS.round > gS.maxRounds) { sdEndGame('stuck', gS.currentOffer); return; }
                sdUpdateOffer(); sdUpdateHints(); return;
            }
            if (reasonReview.score < 45 && userAsk > sc.max) {
                sdAddMsg('them', `I need a stronger business case to go that far above our range. What evidence supports that number?`);
                gS.relationship = clampScore(gS.relationship - 8);
                document.getElementById('sd-input-box').style.opacity = ''; document.getElementById('sd-input-box').style.pointerEvents = '';
                gS.round++; if (gS.round > gS.maxRounds) { sdEndGame('stuck', gS.currentOffer); return; }
                sdUpdateOffer(); sdUpdateHints(); return;
            }
            const qualityMultiplier = reasonReview.score >= 82 ? 1.28 : reasonReview.score >= 65 ? 1 : reasonReview.score >= 45 ? .72 : .42;
            const concessionFraction = (1 - sc.toughness) * (gap / maxGap) * (roundsLeft <= 1 ? 1.2 : 0.8) * qualityMultiplier;
            const concession = Math.max(0, Math.round(Math.round(gap * Math.min(0.65, concessionFraction)) / 1000) * 1000);
            let newOffer = Math.min(sc.max, gS.currentOffer + concession);
            if (newOffer >= userAsk || gS.round >= gS.maxRounds || (sc.max - newOffer < 3000)) {
                newOffer = Math.min(userAsk, sc.max);
                const resp = newOffer >= userAsk ? `We can meet you at $${newOffer.toLocaleString()}. That's our best.` : `We can stretch to $${newOffer.toLocaleString()} - our absolute ceiling.`;
                gS.currentOffer = newOffer; sdUpdateOffer(); sdAddMsg('them', resp); sdEndGame('accepted', newOffer);
            } else {
                const phrases = [`I can go up to $${newOffer.toLocaleString()}. The equity adds significant value.`, `After checking with finance, we can do $${newOffer.toLocaleString()}.`, `We can move to $${newOffer.toLocaleString()} - a meaningful step from our initial offer.`];
                gS.currentOffer = newOffer; gS.round++;
                sdAddMsg('them', phrases[Math.floor(Math.random() * phrases.length)]);
                if (gS.round > gS.maxRounds) { sdEndGame('stuck', newOffer); return; }
                sdUpdateOffer(); sdUpdateHints();
                document.getElementById('sd-input-box').style.opacity = ''; document.getElementById('sd-input-box').style.pointerEvents = '';
                document.getElementById('sd-counter').value = ''; document.getElementById('sd-reason').value = '';
            }
        }

        function sdEndGame(type, finalOffer) {
            const sc = gS.sc, gain = finalOffer - sc.initial, gainPct = Math.round(gain / sc.initial * 100);
            const icon = type === 'accepted' ? (gain > 5000 ? 'trophy' : gain > 0 ? 'confetti' : 'mood-neutral') : 'help-circle';
            const title = type === 'accepted' ? (gain > 10000 ? 'Exceptional Negotiation!' : gain > 3000 ? 'Strong Result!' : 'Deal Secured') : 'Rounds Exhausted';
            const sub = type === 'accepted' ? (gain > 0 ? `You negotiated $${gain.toLocaleString()} above initial (+${gainPct}%).` : 'You accepted the initial offer.') : `Final offer: $${finalOffer.toLocaleString()}.`;
            const moves = gS.moves || [];
            const outcome = clampScore(gain / Math.max(1, sc.max - sc.initial) * 100);
            const strategy = moves.length ? averageScore(moves.map(m => m.review.strategy)) : (gain > 0 ? 55 : 30);
            const evidenceQuality = moves.length ? averageScore(moves.map(m => m.review.evidence_quality)) : 20;
            const professionalTone = moves.length ? averageScore(moves.map(m => m.review.professional_tone)) : 75;
            const adaptability = clampScore((moves.length ? 58 : 30) + (gS.round > 1 ? 15 : 0) + (gS.relationship >= 75 ? 18 : 0) - (gS.aggressiveCount * 10));
            const score = averageScore([strategy, evidenceQuality, professionalTone, adaptability, outcome]);
            updateMinigameBest('salary', { gain, score });
            saveMinigameRun({
                game: 'salary',
                score,
                competency_scores: {
                    strategy,
                    evidence_quality: evidenceQuality,
                    professional_tone: professionalTone,
                    adaptability,
                    outcome,
                },
                summary: `${type === 'accepted' ? 'Deal reached' : 'Negotiation ended'} at $${finalOffer.toLocaleString()} with ${gS.relationship}/100 relationship health.`,
                strengths: [
                    strategy >= 75 ? 'Reasonable anchoring strategy' : '',
                    evidenceQuality >= 75 ? 'Evidence-backed justification' : '',
                    professionalTone >= 80 ? 'Professional tone' : '',
                    outcome >= 75 ? 'Strong compensation outcome' : '',
                ].filter(Boolean),
                improvements: [
                    evidenceQuality < 65 ? 'Use market data, achievements, or competing value evidence.' : '',
                    professionalTone < 70 ? 'Keep the counter collaborative and low-friction.' : '',
                    strategy < 65 ? 'Anchor inside a defensible range instead of jumping far beyond the band.' : '',
                ].filter(Boolean),
                raw: { scenario: sc.name, finalOffer, gain, relationship: gS.relationship, moves },
            });

            const lessons = [];
            if (gain === 0) lessons.push({ ico: 'alert-triangle', text: 'You accepted the first offer. Always counter at least once.' });
            if (gS.lastUserOffer > sc.max * 1.2 && gain < 5000) lessons.push({ ico: 'ruler-2', text: 'Counter was too high. Anchor 10-20% above reality.' });
            if (evidenceQuality >= 75) lessons.push({ ico: 'circle-check', text: 'You justified your ask with evidence - that is the #1 differentiator.' });
            if (evidenceQuality < 55 && moves.length) lessons.push({ ico: 'file-text', text: 'Your reasoning was thin. Add market data, scope, metrics, or competing value.' });
            if (gS.round > 3 && gain > 0) lessons.push({ ico: 'bulb', text: 'Persistence paid off - most candidates quit after round 1.' });
            lessons.push({ ico: 'book-2', text: 'Pro tip: Always negotiate total comp, not just base salary.' });
            const bestMove = moves.length
                ? moves.slice().sort((a, b) => b.review.score - a.review.score)[0]
                : null;
            const missedOpportunity = evidenceQuality < 70
                ? 'You could have tied your counter to market range, scope of responsibility, or measurable past impact.'
                : professionalTone < 75
                    ? 'You could have kept the tone more collaborative while still holding your anchor.'
                    : 'You can now negotiate non-base components like sign-on bonus, equity, PTO, or remote flexibility.';
            const betterCounter = `Given the role scope and my track record delivering measurable results, I was hoping we could get closer to $${Math.min(sc.max, sc.initial + Math.round((sc.max - sc.initial) * .75 / 1000) * 1000).toLocaleString()} base. Is there flexibility in base or sign-on to bridge the gap?`;

            document.getElementById('sd-outcome').innerHTML = `
                <div class="sd-outcome-hero">
                    <div class="sd-outcome-ico">${ti(icon)}</div>
                    <div class="sd-outcome-title">${title}</div>
                    <div class="sd-outcome-sub">${escapeHTML(sub)}</div>
                </div>
                <div class="sd-onum-grid">
                    <div class="sd-onum"><div class="sd-onum-val">$${sc.initial.toLocaleString()}</div><div class="sd-onum-lbl">Initial offer</div></div>
                    <div class="sd-onum"><div class="sd-onum-val" style="color:#4ade80">$${finalOffer.toLocaleString()}</div><div class="sd-onum-lbl">Final deal</div></div>
                    <div class="sd-onum"><div class="sd-onum-val" style="color:${gain > 0 ? '#4ade80' : 'var(--t-fg)'}">+$${gain.toLocaleString()}</div><div class="sd-onum-lbl">Gained</div></div>
                </div>
                <div class="sd-score-grid">
                    ${[
                        ['Strategy', strategy],
                        ['Evidence', evidenceQuality],
                        ['Tone', professionalTone],
                        ['Adapt', adaptability],
                        ['Outcome', outcome],
                    ].map(([label, value]) => `<div class="sd-score-card"><div class="sd-score-val">${value}</div><div class="sd-score-lbl">${label}</div></div>`).join('')}
                </div>
                <div class="sd-best-move">
                    <strong style="color:#4ade80">Best move:</strong> ${bestMove ? `Round ${bestMove.round}, asking $${bestMove.ask.toLocaleString()} with ${bestMove.review.score}/100 reasoning.` : 'You accepted before countering.'}<br>
                    <strong style="color:#fbbf24">Missed opportunity:</strong> ${escapeHTML(missedOpportunity)}<br>
                    <strong style="color:#93c5fd">Better counter:</strong> ${escapeHTML(betterCounter)}
                </div>
                <div class="sd-lessons">
                    <div class="sd-lessons-title">${ti('bulb')} Coaching Takeaways</div>
                    ${lessons.map(l => `<div class="sd-lesson"><span>${ti(l.ico)}</span>${escapeHTML(l.text)}</div>`).join('')}
                </div>
                <div class="sd-cta-row">
                    <button class="sd-btn-primary" onclick="sdRestart()">Try another scenario</button>
                    <button class="sd-btn-secondary" onclick="window.nav('games')">${ti('arrow-left')} Back to Games</button>
                </div>`;
            setTimeout(() => sdShow('sd-outcome'), 1600);
        }

        window.sdRestart = () => { gS = {}; sdShow('sd-intro'); };
        function sdShow(id) { ['sd-intro', 'sd-game', 'sd-outcome'].forEach(s => { document.getElementById(s).style.display = s === id ? 'block' : 'none'; }); }
    }



    // Init app
    window.state = state; // expose for alpine
    window.nav = navigate;
    navigate('hero');
});
