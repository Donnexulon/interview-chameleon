/**
 * body_language.js — MediaPipe-based body language analysis for Interview Chameleon.
 *
 * Uses Face Landmarker + Pose Landmarker from @mediapipe/tasks-vision
 * to track eye contact, expressions, posture, gestures, and head movement.
 * Runs entirely in the browser — no video data is sent to the server.
 */

const BodyLanguageAnalyzer = (() => {
    // ── State ──────────────────────────────────────────────
    let faceLandmarker = null;
    let poseLandmarker = null;
    let videoElement = null;
    let analysisInterval = null;
    let isRunning = false;
    let initialized = false;

    // ── Raw data collectors ────────────────────────────────
    const data = {
        eyeContact: [],       // per-frame: true/false
        expressions: [],      // per-frame: 'neutral'|'positive'|'tense'|'negative'
        posture: [],          // per-frame: { shoulderAngle, spineTilt }
        gestures: [],         // per-frame: { handDelta }
        headMovement: [],     // per-frame: { pitch, yaw, roll }
        timestamps: [],
    };

    // Previous frame data for delta calculations
    let prevLandmarks = null;
    let prevPose = null;

    // ── Constants ──────────────────────────────────────────
    const ANALYSIS_INTERVAL_MS = 130; // ~7.5 FPS analysis (light on CPU)
    const EYE_CENTER_THRESHOLD = 0.40; // iris must be within central 40% of eye

    // ── Initialization ────────────────────────────────────
    async function init() {
        if (initialized) return true;
        try {
            const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import(
                '/static/vendor/mediapipe/vision_bundle.mjs?v=1.0.1'
            );

            const vision = await FilesetResolver.forVisionTasks(
                '/static/vendor/mediapipe/wasm'
            );

            faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: '/static/vendor/mediapipe/models/face_landmarker.task',
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO',
                numFaces: 1,
                outputFaceBlendshapes: true,
                outputFacialTransformationMatrixes: true,
            });

            poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
                baseOptions: {
                    modelAssetPath: '/static/vendor/mediapipe/models/pose_landmarker_lite.task',
                    delegate: 'GPU'
                },
                runningMode: 'VIDEO',
                numPoses: 1,
            });

            initialized = true;
            console.log('[BodyLanguage] MediaPipe initialized successfully');
            return true;
        } catch (err) {
            console.warn('[BodyLanguage] MediaPipe init failed:', err.message);
            return false;
        }
    }

    // ── Start Analysis ────────────────────────────────────
    function start(video) {
        if (!initialized || !video || isRunning) return;
        videoElement = video;
        isRunning = true;
        resetData();

        analysisInterval = setInterval(() => {
            if (videoElement.readyState >= 2) {
                analyzeFrame();
            }
        }, ANALYSIS_INTERVAL_MS);

        console.log('[BodyLanguage] Analysis started');
    }

    // ── Stop Analysis ─────────────────────────────────────
    function stop() {
        if (analysisInterval) {
            clearInterval(analysisInterval);
            analysisInterval = null;
        }
        isRunning = false;
        prevLandmarks = null;
        prevPose = null;
        console.log('[BodyLanguage] Analysis stopped');
    }

    // ── Reset Data ────────────────────────────────────────
    function resetData() {
        data.eyeContact.length = 0;
        data.expressions.length = 0;
        data.posture.length = 0;
        data.gestures.length = 0;
        data.headMovement.length = 0;
        data.timestamps.length = 0;
        prevLandmarks = null;
        prevPose = null;
    }

    // ── Analyze Single Frame ──────────────────────────────
    function analyzeFrame() {
        if (!videoElement || !isRunning) return;
        const now = performance.now();

        try {
            // Face analysis
            if (faceLandmarker) {
                const faceResult = faceLandmarker.detectForVideo(videoElement, now);
                if (faceResult && faceResult.faceLandmarks && faceResult.faceLandmarks.length > 0) {
                    const landmarks = faceResult.faceLandmarks[0];
                    const blendshapes = faceResult.faceBlendshapes?.[0]?.categories || [];

                    data.eyeContact.push(analyzeEyeContact(landmarks));
                    data.expressions.push(analyzeExpression(blendshapes));
                    data.headMovement.push(analyzeHeadMovement(landmarks));
                    prevLandmarks = landmarks;
                } else {
                    // No face detected — count as looking away
                    data.eyeContact.push(false);
                    data.expressions.push('neutral');
                    data.headMovement.push({ pitch: 0, yaw: 0, roll: 0 });
                }
            }

            // Pose analysis
            if (poseLandmarker) {
                const poseResult = poseLandmarker.detectForVideo(videoElement, now);
                if (poseResult && poseResult.landmarks && poseResult.landmarks.length > 0) {
                    const pose = poseResult.landmarks[0];
                    data.posture.push(analyzePosture(pose));
                    data.gestures.push(analyzeGestures(pose));
                    prevPose = pose;
                } else {
                    data.posture.push({ shoulderAngle: 0, spineTilt: 0 });
                    data.gestures.push({ handDelta: 0 });
                }
            }

            data.timestamps.push(now);
        } catch (err) {
            // Silently skip frame errors to avoid interrupting the interview
        }
    }

    // ── Eye Contact Analysis ──────────────────────────────
    function analyzeEyeContact(landmarks) {
        // MediaPipe face mesh: left iris center ~468, right iris center ~473
        // Left eye corners: 33 (outer), 133 (inner)
        // Right eye corners: 362 (outer), 263 (inner)
        try {
            const leftIris = landmarks[468];
            const leftOuter = landmarks[33];
            const leftInner = landmarks[133];

            const rightIris = landmarks[473];
            const rightOuter = landmarks[362];
            const rightInner = landmarks[263];

            // Calculate relative iris position within eye (0 = outer, 1 = inner)
            const leftEyeWidth = Math.abs(leftInner.x - leftOuter.x);
            const leftIrisPos = leftEyeWidth > 0 ? (leftIris.x - leftOuter.x) / leftEyeWidth : 0.5;

            const rightEyeWidth = Math.abs(rightInner.x - rightOuter.x);
            const rightIrisPos = rightEyeWidth > 0 ? (rightIris.x - rightOuter.x) / rightEyeWidth : 0.5;

            const avgPos = (leftIrisPos + rightIrisPos) / 2;

            // Looking at camera = iris roughly centered (between 0.3 and 0.7)
            const lowerBound = (1 - EYE_CENTER_THRESHOLD) / 2;
            const upperBound = 1 - lowerBound;
            return avgPos >= lowerBound && avgPos <= upperBound;
        } catch {
            return false;
        }
    }

    // ── Expression Analysis ───────────────────────────────
    function analyzeExpression(blendshapes) {
        // Map blendshape names to categories
        const scores = {};
        for (const bs of blendshapes) {
            scores[bs.categoryName] = bs.score;
        }

        const smile = (scores['mouthSmileLeft'] || 0) + (scores['mouthSmileRight'] || 0);
        const browDown = (scores['browDownLeft'] || 0) + (scores['browDownRight'] || 0);
        const jawClench = scores['jawForward'] || 0;
        const eyeSquint = (scores['eyeSquintLeft'] || 0) + (scores['eyeSquintRight'] || 0);

        if (smile > 0.4) return 'positive';
        if (browDown > 0.5 || jawClench > 0.3) return 'tense';
        if (eyeSquint > 0.6 && smile < 0.1) return 'negative';
        return 'neutral';
    }

    // ── Head Movement Analysis ────────────────────────────
    function analyzeHeadMovement(landmarks) {
        // Approximate head rotation from face mesh points
        // Nose tip: 1, forehead: 10, chin: 152, left cheek: 234, right cheek: 454
        try {
            const nose = landmarks[1];
            const forehead = landmarks[10];
            const chin = landmarks[152];
            const leftCheek = landmarks[234];
            const rightCheek = landmarks[454];

            // Pitch (nodding): vertical distance nose-to-forehead vs nose-to-chin
            const pitch = (forehead.y - nose.y) - (nose.y - chin.y);

            // Yaw (turning): horizontal asymmetry of cheeks relative to nose
            const yaw = (nose.x - leftCheek.x) - (rightCheek.x - nose.x);

            // Roll (tilting): angle of the line between cheeks
            const roll = Math.atan2(rightCheek.y - leftCheek.y, rightCheek.x - leftCheek.x);

            return { pitch, yaw, roll };
        } catch {
            return { pitch: 0, yaw: 0, roll: 0 };
        }
    }

    // ── Posture Analysis ──────────────────────────────────
    function analyzePosture(pose) {
        try {
            // Pose landmarks: 11 = left shoulder, 12 = right shoulder
            // 23 = left hip, 24 = right hip
            const leftShoulder = pose[11];
            const rightShoulder = pose[12];
            const leftHip = pose[23];
            const rightHip = pose[24];

            // Shoulder angle (tilt)
            const shoulderAngle = Math.atan2(
                rightShoulder.y - leftShoulder.y,
                rightShoulder.x - leftShoulder.x
            ) * (180 / Math.PI);

            // Spine tilt (forward lean)
            const midShoulderY = (leftShoulder.y + rightShoulder.y) / 2;
            const midShoulderX = (leftShoulder.x + rightShoulder.x) / 2;
            const midHipY = (leftHip.y + rightHip.y) / 2;
            const midHipX = (leftHip.x + rightHip.x) / 2;
            const spineTilt = Math.atan2(midShoulderY - midHipY, midShoulderX - midHipX) * (180 / Math.PI);

            return { shoulderAngle, spineTilt };
        } catch {
            return { shoulderAngle: 0, spineTilt: 0 };
        }
    }

    // ── Gesture Analysis ──────────────────────────────────
    function analyzeGestures(pose) {
        try {
            // Track wrist positions: 15 = left wrist, 16 = right wrist
            const leftWrist = pose[15];
            const rightWrist = pose[16];

            let handDelta = 0;
            if (prevPose) {
                const prevLeft = prevPose[15];
                const prevRight = prevPose[16];
                const leftDelta = Math.hypot(leftWrist.x - prevLeft.x, leftWrist.y - prevLeft.y);
                const rightDelta = Math.hypot(rightWrist.x - prevRight.x, rightWrist.y - prevRight.y);
                handDelta = leftDelta + rightDelta;
            }

            return { handDelta };
        } catch {
            return { handDelta: 0 };
        }
    }

    // ── Get Real-Time Metrics (for HUD) ───────────────────
    function getRealtimeMetrics() {
        const n = data.eyeContact.length;
        if (n < 10) return null; // Need at least ~1.3 seconds of data

        // Use last 30 frames (~4 seconds) for real-time display
        const window = 30;
        const start = Math.max(0, n - window);

        const recentEye = data.eyeContact.slice(start);
        const recentExpr = data.expressions.slice(start);
        const recentPosture = data.posture.slice(start);
        const recentGestures = data.gestures.slice(start);

        const eyeScore = Math.round((recentEye.filter(Boolean).length / recentEye.length) * 100);

        // Posture: stability of shoulder angle
        const shoulderAngles = recentPosture.map(p => p.shoulderAngle);
        const shoulderVar = variance(shoulderAngles);
        const postureScore = Math.round(Math.max(0, Math.min(100, 100 - shoulderVar * 50)));

        // Gestures: moderate movement is ideal
        const avgGesture = recentGestures.reduce((s, g) => s + g.handDelta, 0) / recentGestures.length;
        let gestureScore;
        if (avgGesture < 0.005) gestureScore = Math.round(avgGesture / 0.005 * 50);
        else if (avgGesture <= 0.05) gestureScore = Math.round(70 + (avgGesture / 0.05) * 30);
        else gestureScore = Math.round(Math.max(30, 100 - (avgGesture - 0.05) * 500));

        return {
            eye_contact: clamp(eyeScore),
            posture: clamp(postureScore),
            gestures: clamp(gestureScore),
        };
    }

    // ── Get Full Presence Report (end of session) ─────────
    function getPresenceReport() {
        const n = data.eyeContact.length;
        if (n < 20) {
            return { composite: 0, eye_contact: 0, expression: 0, posture: 0, gestures: 0, head_movement: 0 };
        }

        // ─ Eye Contact Score (30% weight)
        const eyeFrames = data.eyeContact.filter(Boolean).length;
        let eyeBase = Math.round((eyeFrames / n) * 100);
        // Penalize long look-away streaks (>3 seconds ≈ >23 frames at 7.5fps)
        let streakCount = 0, currentStreak = 0;
        for (const looking of data.eyeContact) {
            if (!looking) { currentStreak++; } 
            else {
                if (currentStreak > 23) streakCount++;
                currentStreak = 0;
            }
        }
        const eyeScore = clamp(eyeBase - streakCount * 5);

        // ─ Expression Score (20% weight)
        const exprCounts = { neutral: 0, positive: 0, tense: 0, negative: 0 };
        for (const e of data.expressions) exprCounts[e] = (exprCounts[e] || 0) + 1;
        const distinctExprs = Object.values(exprCounts).filter(c => c > 0).length;
        const varietyScore = (distinctExprs / 4) * 40;
        const positiveRatio = (exprCounts.positive / n) * 40;
        const tensePenalty = (exprCounts.tense / n) * -20;
        const expressionScore = clamp(Math.round(varietyScore + positiveRatio + tensePenalty + 20));

        // ─ Posture Score (25% weight)
        const shoulderAngles = data.posture.map(p => p.shoulderAngle);
        const spineAngles = data.posture.map(p => p.spineTilt);
        const shoulderVar = variance(shoulderAngles);
        const avgSpineTilt = Math.abs(mean(spineAngles) + 90); // -90 is perfectly upright
        const alignment = Math.max(0, 100 - shoulderVar * 5);
        const upright = Math.max(0, 100 - avgSpineTilt * 3);
        // Fidget detection: count large position changes
        let fidgets = 0;
        for (let i = 1; i < shoulderAngles.length; i++) {
            if (Math.abs(shoulderAngles[i] - shoulderAngles[i-1]) > 3) fidgets++;
        }
        const fidgetPenalty = (fidgets / n) * -30;
        const postureScore = clamp(Math.round((alignment + upright) / 2 + fidgetPenalty));

        // ─ Gesture Score (15% weight)
        const gestureMagnitudes = data.gestures.map(g => g.handDelta);
        const avgGesture = mean(gestureMagnitudes);
        const gesturesPerMinute = gestureMagnitudes.filter(g => g > 0.01).length / (n * ANALYSIS_INTERVAL_MS / 60000);
        let gestureScore;
        if (gesturesPerMinute < 3) gestureScore = Math.round((gesturesPerMinute / 3) * 50);
        else if (gesturesPerMinute <= 25) gestureScore = Math.round(70 + ((gesturesPerMinute - 3) / 22) * 30);
        else gestureScore = Math.round(Math.max(30, 100 - (gesturesPerMinute - 25) * 3));
        gestureScore = clamp(gestureScore);

        // ─ Head Movement Score (10% weight)
        const pitchValues = data.headMovement.map(h => h.pitch);
        let nodCount = 0;
        for (let i = 2; i < pitchValues.length; i++) {
            // Detect nods: pitch oscillation pattern
            if ((pitchValues[i] - pitchValues[i-1]) * (pitchValues[i-1] - pitchValues[i-2]) < 0) {
                if (Math.abs(pitchValues[i] - pitchValues[i-1]) > 0.005) nodCount++;
            }
        }
        const nodScore = Math.min(40, nodCount * 2);
        const headVar = variance(data.headMovement.map(h => h.yaw));
        const headStability = Math.max(0, 100 - headVar * 300);
        const headScore = clamp(Math.round((nodScore + headStability) / 2 + 10));

        // ─ Composite
        const composite = clamp(Math.round(
            eyeScore * 0.30 +
            expressionScore * 0.20 +
            postureScore * 0.25 +
            gestureScore * 0.15 +
            headScore * 0.10
        ));

        return {
            composite,
            eye_contact: eyeScore,
            expression: expressionScore,
            posture: postureScore,
            gestures: gestureScore,
            head_movement: headScore,
            frames_analyzed: n,
        };
    }

    // ── Utility Functions ─────────────────────────────────
    function mean(arr) {
        return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    }

    function variance(arr) {
        if (arr.length < 2) return 0;
        const m = mean(arr);
        return arr.reduce((sum, v) => sum + (v - m) ** 2, 0) / arr.length;
    }

    function clamp(v, min = 0, max = 100) {
        return Math.max(min, Math.min(max, Math.round(v)));
    }

    // ── Public API ────────────────────────────────────────
    return {
        init,
        start,
        stop,
        getRealtimeMetrics,
        getPresenceReport,
        isInitialized: () => initialized,
        isActive: () => isRunning,
        getFrameCount: () => data.eyeContact.length,
    };
})();

// Export globally
window.BodyLanguageAnalyzer = BodyLanguageAnalyzer;
