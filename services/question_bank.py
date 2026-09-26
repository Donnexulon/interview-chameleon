import sqlite3
import json
import uuid
import hashlib
from contextlib import closing
from typing import List, Dict

class QuestionBank:
    def __init__(self, db_path: str = "interview.db"):
        self.db_path = db_path
        self._init_db()

    def _make_seed_id(self, text: str) -> str:
        """Generate a stable, deterministic ID from question text so seeds are idempotent."""
        return hashlib.sha256(text.encode()).hexdigest()[:36]

    def _init_db(self):
        """Initialize the SQLite database schema for questions and seed missing defaults."""
        with closing(sqlite3.connect(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS questions (
                    id TEXT PRIMARY KEY,
                    category TEXT NOT NULL,
                    text TEXT NOT NULL,
                    difficulty TEXT,
                    tags TEXT,
                    answer TEXT,
                    is_seed INTEGER DEFAULT 0
                )
            ''')

            # Add is_seed column if upgrading from an older schema
            try:
                cursor.execute("SELECT is_seed FROM questions LIMIT 1")
            except sqlite3.OperationalError:
                cursor.execute("ALTER TABLE questions ADD COLUMN is_seed INTEGER DEFAULT 0")

            # Seed default questions using INSERT OR IGNORE — never drops user data
            self._seed_data(cursor)
            
            # Clean up: remove old-format duplicates of seed questions and ensure proper marking
            seed_texts = self._get_seed_texts()
            for text in seed_texts:
                seed_id = self._make_seed_id(text)
                # Delete old-format duplicates (entries with same text but different ID from the seed ID)
                cursor.execute(
                    "DELETE FROM questions WHERE text = ? AND id != ? AND is_seed != 1",
                    (text, seed_id)
                )
                # Ensure the correct entry is marked as seed
                cursor.execute(
                    "UPDATE questions SET is_seed = 1 WHERE text = ? AND id = ?",
                    (text, seed_id)
                )
            
            conn.commit()



    def _get_seed_texts(self):
        """Return all seed question texts for migration matching."""
        return [
            "Tell me about a time you handled a difficult customer complaint.",
            "Describe a situation where you had to persuade a reluctant stakeholder.",
            "How would you onboard a new team member remotely?",
            "Walk me through how you'd de-escalate an angry client on a call.",
            "Give an example of when you failed and what you learned.",
            "How do you prioritize competing requests from multiple managers?",
            "Describe a time you gave difficult feedback to a peer.",
            "Tell me about a time you went above and beyond for a customer.",
            "Sketch a user flow for a food delivery app checkout process.",
            "Redesign the settings page of a mobile banking app.",
            "Draw a component hierarchy for a dashboard with filters.",
            "Create a wireframe for an onboarding flow with 3 steps.",
            "Design a notification system that handles multiple priority levels.",
            "Sketch how you'd lay out a data-heavy analytics page.",
            "Explain the difference between REST and GraphQL. When would you choose each?",
            "Find and fix the bug in this function that reverses a linked list.",
            "Design a URL shortener system. Walk me through the architecture.",
            "What happens when you type a URL into a browser and press Enter?",
            "How would you optimize a slow SQL query on a table with millions of rows?",
            "Implement a debounce function in JavaScript.",
            "Explain how React's reconciliation algorithm works.",
            "Design a rate limiter for an API. What data structures would you use?",
            # FAANG
            "Tell me about a time you demonstrated Customer Obsession.",
            "Describe a situation where you had to Dive Deep into data to solve a problem.",
            "Give an example of a time you showed Bias for Action with incomplete information.",
            "Tell me about a time you Invented or Simplified a complex process.",
            "Describe a time you Earned Trust from a skeptical colleague or stakeholder.",
            "Have you ever disagreed with a manager's decision? How did you handle it?",
            "Tell me about your most technically complex project. How did you approach scale?",
            "Describe a time you failed at a large-scale project and what you did next.",
            "How would you design a system to serve 1 billion users? Walk me through the trade-offs.",
            "Tell me about a time you improved team performance or culture significantly.",
            "How do you make decisions when you have strong data pointing in one direction but your gut says another?",
            "Describe a time you had to influence without authority across team boundaries.",
        ]


    def _seed_data(self, cursor):
        """Seed initial dataset using INSERT OR IGNORE so user-added questions are never lost."""
        seed_questions = [
            # Roleplay (8)
            {"category": "Roleplay", "text": "Tell me about a time you handled a difficult customer complaint.", "difficulty": "Medium", "tags": json.dumps(["Conflict Resolution"]), "answer": "Focus on de-escalation, active listening, and finding a mutually agreeable solution. Avoid assigning blame to the customer."},
            {"category": "Roleplay", "text": "Describe a situation where you had to persuade a reluctant stakeholder.", "difficulty": "Hard", "tags": json.dumps(["Persuasion"]), "answer": "Use data to back up your points, understand their concerns, and align your goals with theirs."},
            {"category": "Roleplay", "text": "How would you onboard a new team member remotely?", "difficulty": "Easy", "tags": json.dumps(["Leadership"]), "answer": "Mention structured check-ins and documentation."},
            {"category": "Roleplay", "text": "Walk me through how you'd de-escalate an angry client on a call.", "difficulty": "Hard", "tags": json.dumps(["Conflict Resolution"]), "answer": "Remain calm, use empathy statements, and outline clear next steps to resolve their issue."},
            {"category": "Roleplay", "text": "Give an example of when you failed and what you learned.", "difficulty": "Medium", "tags": json.dumps(["Self-Awareness"]), "answer": "Focus on the learning outcome, accountability, and the changes implemented to prevent it from happening again."},
            {"category": "Roleplay", "text": "How do you prioritize competing requests from multiple managers?", "difficulty": "Medium", "tags": json.dumps(["Time Management"]), "answer": "Discuss communication, impact assessment, and using an objective matrix to determine urgency vs importance."},
            {"category": "Roleplay", "text": "Describe a time you gave difficult feedback to a peer.", "difficulty": "Medium", "tags": json.dumps(["Communication"]), "answer": "Use the SBI (Situation-Behavior-Impact) model. Keep it objective, timely, and focused on growth."},
            {"category": "Roleplay", "text": "Tell me about a time you went above and beyond for a customer.", "difficulty": "Easy", "tags": json.dumps(["Customer Service"]), "answer": "Detail actions taken outside standard procedures that resulted in a positive outcome for both the customer and company."},
            
            # Visual (4)
            {"category": "Visual", "text": "Sketch a user flow for a food delivery app checkout process.", "difficulty": "Medium", "tags": json.dumps(["UX Flow"]), "answer": "Include cart review, address confirmation, payment selection, and order confirmation states."},
            {"category": "Visual", "text": "Redesign the settings page of a mobile banking app.", "difficulty": "Hard", "tags": json.dumps(["UI Redesign"]), "answer": "Focus on logical grouping of security, notification, and profile settings. Ensure high contrast and clear typography."},
            {"category": "Visual", "text": "Draw a component hierarchy for a dashboard with filters.", "difficulty": "Medium", "tags": json.dumps(["Component Architecture"]), "answer": "Show a Root Dashboard component containing a Sidebar (filters), Header (search), and MainContent (charts/data tables)."},
            {"category": "Visual", "text": "Create a wireframe for an onboarding flow with 3 steps.", "difficulty": "Easy", "tags": json.dumps(["Wireframing"]), "answer": "Include a welcome screen, a value proposition/feature highlight screen, and a final call-to-action (signup/login)."},
            
            # Technical (10)
            {"category": "Technical", "text": "Design a notification system that handles multiple priority levels.", "difficulty": "Hard", "tags": json.dumps(["System Design"]), "answer": "Discuss message queues (RabbitMQ/Kafka), worker services for different channels (SMS, Email, Push), and a priority-based routing layer."},
            {"category": "Technical", "text": "Sketch how you'd lay out a data-heavy analytics page.", "difficulty": "Medium", "tags": json.dumps(["Data Visualization"]), "answer": "Mention responsive grid layouts, lazy loading, pagination, and progressive disclosure for complex data sets."},
            {"category": "Technical", "text": "Explain the difference between REST and GraphQL. When would you choose each?", "difficulty": "Medium", "tags": json.dumps(["API Design"]), "answer": "REST uses distinct endpoints for resources (over-fetching/under-fetching possible). GraphQL uses a single endpoint where the client specifies exact data needs. Use GraphQL for complex frontend requirements; REST for simpler, cacheable services."},
            {"category": "Technical", "text": "Find and fix the bug in this function that reverses a linked list.", "difficulty": "Hard", "tags": json.dumps(["Debugging"]), "answer": "Look for infinite loops, missing pointers (current/prev/next), or failure to handle edge cases like empty lists or single nodes."},
            {"category": "Technical", "text": "Design a URL shortener system. Walk me through the architecture.", "difficulty": "Hard", "tags": json.dumps(["System Design"]), "answer": "Discuss Base62 encoding, a key generation service, collision handling, and caching (Redis) for fast redirects."},
            {"category": "Technical", "text": "What happens when you type a URL into a browser and press Enter?", "difficulty": "Easy", "tags": json.dumps(["Fundamentals"]), "answer": "DNS resolution, TCP connection, TLS handshake, HTTP request/response, and browser DOM rendering."},
            {"category": "Technical", "text": "How would you optimize a slow SQL query on a table with millions of rows?", "difficulty": "Medium", "tags": json.dumps(["Database"]), "answer": "Use EXPLAIN ANALYZE, add appropriate indexes, avoid SELECT *, partition the table, or denormalize data if read-heavy."},
            {"category": "Technical", "text": "Implement a debounce function in JavaScript.", "difficulty": "Medium", "tags": json.dumps(["Coding"]), "answer": "Use setTimeout and clearTimeout to delay the execution of a function until after a specified wait time has elapsed since the last call."},
            {"category": "Technical", "text": "Explain how React's reconciliation algorithm works.", "difficulty": "Medium", "tags": json.dumps(["Frontend"]), "answer": "React creates a Virtual DOM, compares it with the previous version (diffing), and calculates the minimal set of changes needed to update the actual DOM."},
            {"category": "Technical", "text": "Design a rate limiter for an API. What data structures would you use?", "difficulty": "Hard", "tags": json.dumps(["System Design"]), "answer": "Discuss algorithms like Token Bucket, Leaky Bucket, or Fixed/Sliding Window counters. Recommend using Redis for distributed caching."},

            # FAANG / Big Tech (12)
            {"category": "FAANG", "text": "Tell me about a time you demonstrated Customer Obsession.", "difficulty": "Medium", "tags": json.dumps(["Leadership Principles"]), "answer": "Lead with a specific customer problem. Quantify the impact (e.g., NPS change, churn reduction). Use STAR. Show you went beyond the obvious solution."},
            {"category": "FAANG", "text": "Describe a situation where you had to Dive Deep into data to solve a problem.", "difficulty": "Hard", "tags": json.dumps(["Leadership Principles"]), "answer": "Highlight the specific analysis performed, the tool or query used, what the data revealed, and the decision it unlocked. Avoid vague 'I looked at metrics' answers."},
            {"category": "FAANG", "text": "Give an example of a time you showed Bias for Action with incomplete information.", "difficulty": "Medium", "tags": json.dumps(["Leadership Principles"]), "answer": "Show you calculated the risk, acted decisively, course-corrected quickly if needed, and documented learnings. Avoid framing recklessness as bias-for-action."},
            {"category": "FAANG", "text": "Tell me about a time you Invented or Simplified a complex process.", "difficulty": "Medium", "tags": json.dumps(["Leadership Principles"]), "answer": "Quantify the before/after (e.g., reduced steps from 12 to 3, saved 4 hours/week). Show original thinking, not just 'I used an existing tool'."},
            {"category": "FAANG", "text": "Describe a time you Earned Trust from a skeptical colleague or stakeholder.", "difficulty": "Hard", "tags": json.dumps(["Leadership Principles"]), "answer": "Focus on consistent behaviour over time, transparent communication, and follow-through. Avoid making it sound like you just 'charmed' them."},
            {"category": "FAANG", "text": "Have you ever disagreed with a manager's decision? How did you handle it?", "difficulty": "Hard", "tags": json.dumps(["Disagree & Commit"]), "answer": "Show you voiced your view with data, respected the final call, and committed fully. This is the Disagree & Commit LP — never imply you went rogue."},
            {"category": "FAANG", "text": "Tell me about your most technically complex project. How did you approach scale?", "difficulty": "Hard", "tags": json.dumps(["Technical Depth"]), "answer": "Discuss your scale assumptions, bottlenecks identified, the architecture decisions made, and trade-offs accepted. Quantify scale (e.g., '50k RPS', '10M DAUs')."},
            {"category": "FAANG", "text": "Describe a time you failed at a large-scale project and what you did next.", "difficulty": "Hard", "tags": json.dumps(["Ownership"]), "answer": "Own the failure completely. Describe the root cause analysis, the immediate mitigation, the long-term fix, and the systemic change that prevented recurrence."},
            {"category": "FAANG", "text": "How would you design a system to serve 1 billion users? Walk me through the trade-offs.", "difficulty": "Hard", "tags": json.dumps(["System Design at Scale"]), "answer": "Address: Horizontal scaling, CDN, read replicas, sharding, eventual consistency vs. strong consistency, caching layers (CDN, Redis), and async processing via queues."},
            {"category": "FAANG", "text": "Tell me about a time you improved team performance or culture significantly.", "difficulty": "Medium", "tags": json.dumps(["Leadership"]), "answer": "Show a measurable outcome (e.g., 30% faster deployments, reduced oncall burnout). Focus on systemic change, not one-off heroics."},
            {"category": "FAANG", "text": "How do you make decisions when you have strong data pointing in one direction but your gut says another?", "difficulty": "Hard", "tags": json.dumps(["Decision Making"]), "answer": "Top-tier answer: you run a small, fast experiment to resolve the disagreement. Show you neither blindly follow data nor ignore it — you probe the discrepancy."},
            {"category": "FAANG", "text": "Describe a time you had to influence without authority across team boundaries.", "difficulty": "Hard", "tags": json.dumps(["Influence"]), "answer": "Show you understood other teams' incentives, framed the ask in terms of their goals, built coalition support early, and closed with a win-win outcome."},
        ]
        
        for q in seed_questions:
            seed_id = self._make_seed_id(q["text"])
            cursor.execute('''
                INSERT OR IGNORE INTO questions (id, category, text, difficulty, tags, answer, is_seed)
                VALUES (?, ?, ?, ?, ?, ?, 1)
            ''', (seed_id, q["category"], q["text"], q["difficulty"], q["tags"], q.get("answer", "")))

    def get_questions(self, category: str = None) -> List[Dict]:
        """Retrieve questions, optionally filtered by category."""
        with closing(sqlite3.connect(self.db_path)) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            if category:
                cursor.execute("SELECT * FROM questions WHERE category = ?", (category,))
            else:
                cursor.execute("SELECT * FROM questions")
            rows = cursor.fetchall()
            
            return [{
                "id": row["id"],
                "category": row["category"],
                "text": row["text"],
                "difficulty": row["difficulty"],
                "tags": json.loads(row["tags"]) if row["tags"] else [],
                "answer": row["answer"] if "answer" in row.keys() else "",
                "is_seed": bool(row["is_seed"]) if "is_seed" in row.keys() else False
            } for row in rows]

    def add_question(self, question: Dict):
        """Add a new user question to the bank."""
        with closing(sqlite3.connect(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                INSERT INTO questions (id, category, text, difficulty, tags, answer, is_seed)
                VALUES (?, ?, ?, ?, ?, ?, 0)
            ''', (
                question["id"],
                question["category"],
                question["text"],
                question.get("difficulty", "Medium"),
                json.dumps(question.get("tags", [])),
                question.get("answer", "")
            ))
            conn.commit()

    def update_question(self, question_id: str, question: Dict):
        """Update an existing question."""
        with closing(sqlite3.connect(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE questions
                SET category = ?, text = ?, difficulty = ?, tags = ?, answer = ?
                WHERE id = ?
            ''', (
                question["category"],
                question["text"],
                question.get("difficulty", "Medium"),
                json.dumps(question.get("tags", [])),
                question.get("answer", ""),
                question_id
            ))
            conn.commit()
            return cursor.rowcount > 0

    def delete_question(self, question_id: str):
        """Delete a question."""
        with closing(sqlite3.connect(self.db_path)) as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM questions WHERE id = ?", (question_id,))
            conn.commit()
            return cursor.rowcount > 0
