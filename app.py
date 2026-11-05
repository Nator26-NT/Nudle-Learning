"""
Nudle Interactive Learning & Simulation Management Platform
Main Flask application with authentication, learner management,
activity assignment, and the Computer Hardware Troubleshooting simulation.
"""
import os
import json
import sqlite3
from datetime import datetime, timezone
from functools import wraps

from flask import (
    Flask, request, jsonify, session, render_template,
    redirect, url_for, g, send_from_directory
)
from werkzeug.security import generate_password_hash, check_password_hash

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
DB_PATH = os.path.join(BASE_DIR, "nudle.db")


def utc_now_iso():
    """Return a timezone-aware UTC timestamp as an ISO-8601 string.

    Replaces the deprecated datetime.utcnow() with datetime.now(timezone.utc),
    which is timezone-aware and does not emit DeprecationWarnings on Python 3.12+.
    """
    return datetime.now(timezone.utc).isoformat()


app = Flask(__name__, template_folder=".", static_folder=".")
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-secret-change-me")
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"


# --------------------------------------------------------------------------
# Database helpers
# --------------------------------------------------------------------------
def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db


@app.teardown_appcontext
def close_db(exc=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db():
    """Create tables and seed default data."""
    db = sqlite3.connect(DB_PATH)
    db.executescript(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL CHECK(role IN ('admin','learner')),
            active INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS activities (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT NOT NULL,
            type TEXT NOT NULL DEFAULT 'simulation',
            difficulty TEXT NOT NULL DEFAULT 'medium',
            created_at TEXT NOT NULL,
            active INTEGER NOT NULL DEFAULT 1
        );

        CREATE TABLE IF NOT EXISTS assignments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            activity_id INTEGER NOT NULL,
            learner_id INTEGER NOT NULL,
            assigned_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'assigned',
            UNIQUE(activity_id, learner_id),
            FOREIGN KEY(activity_id) REFERENCES activities(id) ON DELETE CASCADE,
            FOREIGN KEY(learner_id) REFERENCES users(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            assignment_id INTEGER NOT NULL,
            learner_id INTEGER NOT NULL,
            activity_id INTEGER NOT NULL,
            score INTEGER NOT NULL,
            max_score INTEGER NOT NULL,
            decisions TEXT NOT NULL,
            completed_at TEXT NOT NULL,
            FOREIGN KEY(assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            actor_id INTEGER,
            action TEXT NOT NULL,
            details TEXT,
            created_at TEXT NOT NULL
        );
        """
    )

    # Seed admin
    cur = db.execute("SELECT id FROM users WHERE email = ?", ("admin@nudle.com",))
    if not cur.fetchone():
        db.execute(
            "INSERT INTO users (name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)",
            ("Platform Admin", "admin@nudle.com",
             generate_password_hash("Admin123!"), "admin", utc_now_iso()),
        )

    # Seed a demo learner
    cur = db.execute("SELECT id FROM users WHERE email = ?", ("learner@nudle.com",))
    if not cur.fetchone():
        db.execute(
            "INSERT INTO users (name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)",
            ("Demo Learner", "learner@nudle.com",
             generate_password_hash("Learner123!"), "learner", utc_now_iso()),
        )

    # Seed the hardware troubleshooting activity
    cur = db.execute("SELECT id FROM activities WHERE title = ?",
                     ("Computer Hardware Troubleshooting",))
    if not cur.fetchone():
        db.execute(
            "INSERT INTO activities (title,description,type,difficulty,created_at,active) "
            "VALUES (?,?,?,?,?,1)",
            ("Computer Hardware Troubleshooting",
             "Diagnose and repair a computer that fails to boot. Investigate symptoms, "
             "choose diagnostic actions and identify the faulty component.",
             "simulation", "medium", utc_now_iso()),
        )

    db.commit()
    db.close()


def log_action(actor_id, action, details=""):
    db = get_db()
    db.execute(
        "INSERT INTO audit_log (actor_id,action,details,created_at) VALUES (?,?,?,?)",
        (actor_id, action, json.dumps(details) if not isinstance(details, str) else details,
         utc_now_iso()),
    )
    db.commit()


# --------------------------------------------------------------------------
# Auth decorators / helpers
# --------------------------------------------------------------------------
def current_user():
    uid = session.get("user_id")
    if not uid:
        return None
    row = get_db().execute("SELECT * FROM users WHERE id = ? AND active = 1", (uid,)).fetchone()
    return dict(row) if row else None


def login_required(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get("user_id"):
            return jsonify({"error": "Authentication required"}), 401
        return f(*args, **kwargs)
    return wrapper


def role_required(role):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            user = current_user()
            if not user:
                return jsonify({"error": "Authentication required"}), 401
            if user["role"] != role:
                return jsonify({"error": "Forbidden"}), 403
            return f(*args, **kwargs)
        return wrapper
    return decorator


# --------------------------------------------------------------------------
# Simulation definition (branching scenario)
# --------------------------------------------------------------------------
SIMULATION = {
    "id": "hardware-troubleshooting",
    "title": "Computer Hardware Troubleshooting",
    "intro": (
        "A user reports that their desktop computer does not boot. The power LED is off, "
        "no fans spin, and there is no display. Investigate the symptoms and identify "
        "the faulty component. Good luck, technician!"
    ),
    "start": "power_check",
    "nodes": {
        "power_check": {
            "prompt": "The PC is completely dead. What is your first diagnostic action?",
            "options": [
                {"label": "Check that the power cable is firmly connected at both ends",
                 "next": "cable_check", "points": 5, "feedback": "Good first step - always verify the basics."},
                {"label": "Immediately replace the power supply unit (PSU)",
                 "next": "psu_replace_wrong", "points": -5,
                 "feedback": "Too hasty. Rule out simple causes before swapping hardware."},
                {"label": "Open the case and inspect the motherboard for burn marks",
                 "next": "visual_inspect", "points": 2,
                 "feedback": "Visual inspection is useful, but check power delivery first."},
            ],
        },
        "cable_check": {
            "prompt": "The power cable is secure, but the PC is still dead. What now?",
            "options": [
                {"label": "Test the wall outlet with another device",
                 "next": "outlet_test", "points": 5,
                 "feedback": "Smart - isolate the power source before the PC."},
                {"label": "Replace the PSU immediately",
                 "next": "psu_replace_wrong", "points": -3,
                 "feedback": "Still premature. Verify the outlet first."},
                {"label": "Press the front panel power button several times",
                 "next": "button_test", "points": 3,
                 "feedback": "Reasonable, but a known-good outlet test is more decisive."},
            ],
        },
        "outlet_test": {
            "prompt": "The outlet works with another device. The PC is still silent. Next step?",
            "options": [
                {"label": "Check the PSU voltage switch (110V/220V) and PSU fan",
                 "next": "psu_diagnose", "points": 6,
                 "feedback": "Excellent - verify PSU configuration and operation."},
                {"label": "Replace the motherboard",
                 "next": "motherboard_wrong", "points": -6,
                 "feedback": "Never replace the most expensive part first without evidence."},
                {"label": "Reseat the RAM",
                 "next": "ram_wrong", "points": -2,
                 "feedback": "RAM won't stop fans from spinning. Focus on power."},
            ],
        },
        "psu_diagnose": {
            "prompt": "The PSU fan does not spin when powered. What is your conclusion?",
            "options": [
                {"label": "The PSU is faulty - replace it with a known-good unit",
                 "next": "success", "points": 10,
                 "feedback": "Correct! A dead PSU explains a completely silent system."},
                {"label": "The motherboard is faulty",
                 "next": "motherboard_wrong", "points": -4,
                 "feedback": "The PSU failing to spin strongly indicates the PSU itself."},
                {"label": "The CPU is faulty",
                 "next": "cpu_wrong", "points": -4,
                 "feedback": "A dead CPU would still let fans spin. Reconsider power."},
            ],
        },
        "psu_replace_wrong": {
            "prompt": "You replaced the PSU, but the PC is still dead. What did you likely miss?",
            "options": [
                {"label": "Verify the wall outlet and power cable first",
                 "next": "outlet_test", "points": 3,
                 "feedback": "Right - always isolate the power source before parts."},
                {"label": "Replace the motherboard too",
                 "next": "motherboard_wrong", "points": -4,
                 "feedback": "That compounds the error. Diagnose, don't guess."},
            ],
        },
        "visual_inspect": {
            "prompt": "No obvious burn marks. What is your next action?",
            "options": [
                {"label": "Check power delivery: cable, outlet, then PSU",
                 "next": "outlet_test", "points": 5,
                 "feedback": "Good - move systematically through power delivery."},
                {"label": "Replace the GPU",
                 "next": "gpu_wrong", "points": -4,
                 "feedback": "A dead GPU would not stop fans or power LEDs."},
            ],
        },
        "button_test": {
            "prompt": "The button feels fine but nothing happens. Next step?",
            "options": [
                {"label": "Test the outlet and check the PSU",
                 "next": "outlet_test", "points": 5,
                 "feedback": "Good - back to power delivery."},
                {"label": "Replace the front panel",
                 "next": "front_panel_wrong", "points": -3,
                 "feedback": "Unlikely to be the root cause given a completely dead system."},
            ],
        },
        "ram_wrong": {
            "prompt": "Reseating RAM did not help. What should you have checked first?",
            "options": [
                {"label": "Power delivery from the wall to the PSU",
                 "next": "outlet_test", "points": 3,
                 "feedback": "Correct - power comes before RAM."},
                {"label": "Replace the RAM sticks",
                 "next": "ram_wrong", "points": -3,
                 "feedback": "Still the wrong direction. Focus on power."},
            ],
        },
        "motherboard_wrong": {
            "prompt": "The replacement motherboard didn't fix it. Reassess: what is the true root cause?",
            "options": [
                {"label": "The PSU - test and replace it",
                 "next": "success", "points": 4,
                 "feedback": "Better late than never. The PSU was the culprit."},
                {"label": "The CPU",
                 "next": "cpu_wrong", "points": -3,
                 "feedback": "Incorrect - a dead CPU usually still allows fans to spin."},
            ],
        },
        "gpu_wrong": {
            "prompt": "Replacing the GPU didn't help. What should you focus on?",
            "options": [
                {"label": "Power delivery - outlet, cable, then PSU",
                 "next": "outlet_test", "points": 3,
                 "feedback": "Correct - trace power first."},
                {"label": "Replace the CPU",
                 "next": "cpu_wrong", "points": -3,
                 "feedback": "Wrong direction again. Trace the power path."},
            ],
        },
        "cpu_wrong": {
            "prompt": "The CPU was not the issue. Final attempt: identify the fault.",
            "options": [
                {"label": "The PSU is faulty",
                 "next": "success", "points": 4,
                 "feedback": "Correct - the PSU was the root cause."},
                {"label": "The RAM is faulty",
                 "next": "ram_wrong", "points": -2,
                 "feedback": "Incorrect - RAM issues usually still allow fans to spin."},
            ],
        },
        "front_panel_wrong": {
            "prompt": "A new front panel did not fix it. What now?",
            "options": [
                {"label": "Trace power: outlet, cable, PSU",
                 "next": "outlet_test", "points": 3,
                 "feedback": "Correct - power path is the key."},
                {"label": "Replace the PSU without testing",
                 "next": "psu_replace_wrong", "points": -2,
                 "feedback": "Test before replacing."},
            ],
        },
        "success": {
            "prompt": "You identified and fixed the faulty PSU. The PC boots successfully!",
            "options": [],
            "terminal": True,
        },
    },
}

MAX_SCORE = 36  # approximate maximum achievable path total


# --------------------------------------------------------------------------
# Pages
# --------------------------------------------------------------------------
@app.route("/")
def index():
    if session.get("user_id"):
        user = current_user()
        if user:
            return redirect(url_for("admin_page" if user["role"] == "admin" else "learner_page"))
    return render_template("index.html")


@app.route("/app")
def admin_page():
    return render_template("index.html")


@app.route("/learner")
def learner_page():
    return render_template("index.html")


# --------------------------------------------------------------------------
# Auth API
# --------------------------------------------------------------------------
@app.post("/api/login")
def api_login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email or not password:
        return jsonify({"error": "Email and password are required"}), 400

    user = get_db().execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not user or not check_password_hash(user["password_hash"], password):
        return jsonify({"error": "Invalid credentials"}), 401
    if not user["active"]:
        return jsonify({"error": "This account has been deactivated"}), 403

    session["user_id"] = user["id"]
    log_action(user["id"], "login", {"email": email})
    return jsonify({
        "user": {"id": user["id"], "name": user["name"], "email": user["email"], "role": user["role"]}
    })


@app.post("/api/logout")
def api_logout():
    uid = session.get("user_id")
    if uid:
        log_action(uid, "logout", "")
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
@login_required
def api_me():
    user = current_user()
    if not user:
        return jsonify({"error": "Authentication required"}), 401
    return jsonify({"user": {"id": user["id"], "name": user["name"],
                            "email": user["email"], "role": user["role"]}})


# --------------------------------------------------------------------------
# Admin APIs - dashboard & learner management
# --------------------------------------------------------------------------
@app.get("/api/admin/stats")
@role_required("admin")
def admin_stats():
    db = get_db()
    total_learners = db.execute(
        "SELECT COUNT(*) c FROM users WHERE role='learner'").fetchone()["c"]
    active_learners = db.execute(
        "SELECT COUNT(*) c FROM users WHERE role='learner' AND active=1").fetchone()["c"]
    assigned = db.execute("SELECT COUNT(*) c FROM assignments").fetchone()["c"]
    completed = db.execute(
        "SELECT COUNT(*) c FROM assignments WHERE status='completed'").fetchone()["c"]
    rate = round((completed / assigned * 100), 1) if assigned else 0

    # Recent activity per day (last 7 days) for the chart
    rows = db.execute(
        """SELECT substr(completed_at,1,10) d, COUNT(*) c FROM results
           GROUP BY d ORDER BY d DESC LIMIT 7"""
    ).fetchall()
    chart = [{"date": r["d"], "completions": r["c"]} for r in reversed(rows)]

    return jsonify({
        "total_learners": total_learners,
        "active_learners": active_learners,
        "assigned_activities": assigned,
        "completed_activities": completed,
        "completion_rate": rate,
        "chart": chart,
    })


@app.get("/api/admin/learners")
@role_required("admin")
def admin_learners():
    q = (request.args.get("q") or "").strip()
    status = request.args.get("status") or ""
    sql = "SELECT id,name,email,active,created_at FROM users WHERE role='learner'"
    params = []
    if q:
        sql += " AND (name LIKE ? OR email LIKE ?)"
        params += [f"%{q}%", f"%{q}%"]
    if status in ("active", "inactive"):
        sql += " AND active = ?"
        params.append(1 if status == "active" else 0)
    sql += " ORDER BY created_at DESC"

    rows = get_db().execute(sql, params).fetchall()

    # attach assignment summary
    out = []
    for r in rows:
        stats = get_db().execute(
            """SELECT COUNT(*) total,
                      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) done
               FROM assignments WHERE learner_id = ?""", (r["id"],)).fetchone()
        out.append({
            "id": r["id"], "name": r["name"], "email": r["email"],
            "active": bool(r["active"]), "created_at": r["created_at"],
            "assignments": stats["total"] or 0, "completed": stats["done"] or 0,
        })
    return jsonify({"learners": out})


@app.post("/api/admin/learners")
@role_required("admin")
def admin_add_learner():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not name or not email or not password:
        return jsonify({"error": "Name, email and password are required"}), 400
    if len(password) < 8:
        return jsonify({"error": "Password must be at least 8 characters"}), 400
    db = get_db()
    if db.execute("SELECT 1 FROM users WHERE email=?", (email,)).fetchone():
        return jsonify({"error": "Email already exists"}), 409
    db.execute(
        "INSERT INTO users (name,email,password_hash,role,active,created_at) VALUES (?,?,?,?,1,?)",
        (name, email, generate_password_hash(password), "learner", utc_now_iso()),
    )
    db.commit()
    log_action(current_user()["id"], "add_learner", {"email": email})
    return jsonify({"ok": True}), 201


@app.put("/api/admin/learners/<int:lid>")
@role_required("admin")
def admin_update_learner(lid):
    data = request.get_json(silent=True) or {}
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id=? AND role='learner'", (lid,)).fetchone()
    if not row:
        return jsonify({"error": "Learner not found"}), 404
    name = (data.get("name") or row["name"]).strip()
    email = (data.get("email") or row["email"]).strip().lower()
    active = 1 if data.get("active", bool(row["active"])) else 0
    db.execute("UPDATE users SET name=?, email=?, active=? WHERE id=?",
               (name, email, active, lid))
    db.commit()
    log_action(current_user()["id"], "update_learner", {"id": lid})
    return jsonify({"ok": True})


@app.post("/api/admin/learners/<int:lid>/toggle")
@role_required("admin")
def admin_toggle_learner(lid):
    db = get_db()
    row = db.execute("SELECT * FROM users WHERE id=? AND role='learner'", (lid,)).fetchone()
    if not row:
        return jsonify({"error": "Learner not found"}), 404
    new_state = 0 if row["active"] else 1
    db.execute("UPDATE users SET active=? WHERE id=?", (new_state, lid))
    db.commit()
    log_action(current_user()["id"], "toggle_learner", {"id": lid, "active": new_state})
    return jsonify({"ok": True, "active": bool(new_state)})


# --------------------------------------------------------------------------
# Activities & assignments
# --------------------------------------------------------------------------
@app.get("/api/activities")
@login_required
def list_activities():
    rows = get_db().execute(
        "SELECT * FROM activities WHERE active=1 ORDER BY created_at DESC").fetchall()
    return jsonify({"activities": [dict(r) for r in rows]})


@app.post("/api/admin/activities")
@role_required("admin")
def admin_create_activity():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    description = (data.get("description") or "").strip()
    if not title or not description:
        return jsonify({"error": "Title and description are required"}), 400
    db = get_db()
    db.execute(
        "INSERT INTO activities (title,description,type,difficulty,created_at,active) "
        "VALUES (?,?,?,?,?,1)",
        (title, description, "simulation", data.get("difficulty", "medium"),
         utc_now_iso()),
    )
    db.commit()
    log_action(current_user()["id"], "create_activity", {"title": title})
    return jsonify({"ok": True}), 201


@app.post("/api/admin/assign")
@role_required("admin")
def admin_assign():
    data = request.get_json(silent=True) or {}
    activity_id = data.get("activity_id")
    learner_ids = data.get("learner_ids") or []
    if not activity_id or not isinstance(learner_ids, list) or not learner_ids:
        return jsonify({"error": "activity_id and learner_ids are required"}), 400
    db = get_db()
    if not db.execute("SELECT 1 FROM activities WHERE id=?", (activity_id,)).fetchone():
        return jsonify({"error": "Activity not found"}), 404
    count = 0
    for lid in learner_ids:
        try:
            db.execute(
                "INSERT INTO assignments (activity_id,learner_id,assigned_at,status) "
                "VALUES (?,?,?,'assigned')",
                (activity_id, lid, utc_now_iso()),
            )
            count += 1
        except sqlite3.IntegrityError:
            pass  # already assigned
    db.commit()
    log_action(current_user()["id"], "assign_activity",
               {"activity_id": activity_id, "count": count})
    return jsonify({"ok": True, "assigned": count})


@app.get("/api/admin/learner/<int:lid>/progress")
@role_required("admin")
def admin_learner_progress(lid):
    db = get_db()
    learner = db.execute(
        "SELECT id,name,email,active FROM users WHERE id=? AND role='learner'", (lid,)
    ).fetchone()
    if not learner:
        return jsonify({"error": "Learner not found"}), 404
    rows = db.execute(
        """SELECT a.id assignment_id, a.status, a.assigned_at,
                  ac.title, ac.description,
                  r.score, r.max_score, r.completed_at
           FROM assignments a
           JOIN activities ac ON ac.id = a.activity_id
           LEFT JOIN results r ON r.assignment_id = a.id
           WHERE a.learner_id = ?
           ORDER BY a.assigned_at DESC""", (lid,)
    ).fetchall()
    return jsonify({
        "learner": dict(learner),
        "progress": [dict(r) for r in rows],
    })


# --------------------------------------------------------------------------
# Learner APIs
# --------------------------------------------------------------------------
@app.get("/api/learner/dashboard")
@role_required("learner")
def learner_dashboard():
    user = current_user()
    db = get_db()
    rows = db.execute(
        """SELECT a.id assignment_id, a.status, a.assigned_at,
                  ac.id activity_id, ac.title, ac.description, ac.difficulty,
                  r.score, r.max_score, r.completed_at
           FROM assignments a
           JOIN activities ac ON ac.id = a.activity_id
           LEFT JOIN results r ON r.assignment_id = a.id
           WHERE a.learner_id = ?
           ORDER BY a.assigned_at DESC""", (user["id"],)
    ).fetchall()
    items = [dict(r) for r in rows]
    completed = [i for i in items if i["status"] == "completed"]
    avg = None
    if completed:
        pct = [(i["score"] / i["max_score"] * 100) for i in completed if i["max_score"]]
        avg = round(sum(pct) / len(pct), 1) if pct else None
    return jsonify({
        "user": {"id": user["id"], "name": user["name"], "email": user["email"]},
        "assignments": items,
        "summary": {"total": len(items), "completed": len(completed), "average_score": avg},
    })


@app.get("/api/learner/assignment/<int:aid>")
@role_required("learner")
def learner_get_assignment(aid):
    user = current_user()
    db = get_db()
    row = db.execute(
        """SELECT a.*, ac.title, ac.description FROM assignments a
           JOIN activities ac ON ac.id=a.activity_id
           WHERE a.id=? AND a.learner_id=?""", (aid, user["id"])
    ).fetchone()
    if not row:
        return jsonify({"error": "Assignment not found"}), 404
    return jsonify({"assignment": dict(row), "simulation": SIMULATION})


@app.post("/api/learner/assignment/<int:aid>/submit")
@role_required("learner")
def learner_submit(aid):
    user = current_user()
    data = request.get_json(silent=True) or {}
    decisions = data.get("decisions")
    if not isinstance(decisions, list):
        return jsonify({"error": "decisions must be a list"}), 400
    db = get_db()
    row = db.execute(
        "SELECT * FROM assignments WHERE id=? AND learner_id=?", (aid, user["id"])
    ).fetchone()
    if not row:
        return jsonify({"error": "Assignment not found"}), 404

    # Recompute score server-side (never trust client-provided score)
    node = SIMULATION["start"]
    score = 0
    for step in decisions:
        if node not in SIMULATION["nodes"]:
            break
        current = SIMULATION["nodes"][node]
        options = current.get("options", [])
        idx = step.get("option")
        if not isinstance(idx, int) or idx < 0 or idx >= len(options):
            return jsonify({"error": "Invalid decision"}), 400
        opt = options[idx]
        score += opt.get("points", 0)
        node = opt["next"]
    score = max(0, min(score, MAX_SCORE))

    db.execute(
        "INSERT INTO results (assignment_id,learner_id,activity_id,score,max_score,decisions,completed_at) "
        "VALUES (?,?,?,?,?,?,?)",
        (aid, user["id"], row["activity_id"], score, MAX_SCORE,
         json.dumps(decisions), utc_now_iso()),
    )
    db.execute("UPDATE assignments SET status='completed' WHERE id=?", (aid,))
    db.commit()
    log_action(user["id"], "complete_simulation", {"assignment_id": aid, "score": score})
    return jsonify({"ok": True, "score": score, "max_score": MAX_SCORE})


@app.get("/api/learner/history")
@role_required("learner")
def learner_history():
    user = current_user()
    rows = get_db().execute(
        """SELECT r.id, r.score, r.max_score, r.completed_at, ac.title
           FROM results r JOIN activities ac ON ac.id=r.activity_id
           WHERE r.learner_id=? ORDER BY r.completed_at DESC""", (user["id"],)
    ).fetchall()
    return jsonify({"history": [dict(r) for r in rows]})


# --------------------------------------------------------------------------
# Admin report export
# --------------------------------------------------------------------------
@app.get("/api/admin/export")
@role_required("admin")
def admin_export():
    db = get_db()
    rows = db.execute(
        """SELECT u.name learner, u.email, ac.title activity, a.status,
                  r.score, r.max_score, r.completed_at
           FROM assignments a
           JOIN users u ON u.id = a.learner_id
           JOIN activities ac ON ac.id = a.activity_id
           LEFT JOIN results r ON r.assignment_id = a.id
           ORDER BY u.name"""
    ).fetchall()
    return jsonify({"report": [dict(r) for r in rows]})


@app.get("/api/admin/audit")
@role_required("admin")
def admin_audit():
    rows = db.execute(
        "SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 200"
    ).fetchall()
    return jsonify({"log": [dict(r) for r in rows]}) if False else jsonify(
        {"log": [dict(r) for r in rows]}
    )


# --------------------------------------------------------------------------
# Static file serving (keeps everything in the same folder for simplicity)
# --------------------------------------------------------------------------
@app.route("/static/<path:filename>")
def static_files(filename):
    return send_from_directory(BASE_DIR, filename)


@app.errorhandler(404)
def not_found(e):
    if request.path.startswith("/api/"):
        return jsonify({"error": "Not found"}), 404
    return render_template("index.html")


if __name__ == "__main__":
    init_db()
    # Port 5000 is commonly grabbed by other Windows services (e.g. AirPlay/DLNA).
    # Use 5500 by default, but allow overriding via the PORT env var.
    port = int(os.environ.get("PORT", 5500))
    app.run(debug=True, host="0.0.0.0", port=port)