// @ts-nocheck
/* ==========================================================================
   Nudle Learning Platform - Front-end application
   Vanilla JS SPA: auth, admin dashboard, learner dashboard, simulation.

   NOTE: The `// @ts-nocheck` directive disables TypeScript diagnostics for
   this plain-JS file. It prevents spurious TS1109/TS1005 errors in VS Code
   when the language service misparses valid JavaScript.
   ========================================================================== */

/* ============================ API WRAPPER ============================= */
var API = {
    request: async function(path, options) {
        options = options || {};
        var method = options.method || "GET";
        var body = options.body;

        var opts = {
            method: method,
            headers: {},
            credentials: "same-origin",
        };
        if (body !== undefined) {
            opts.headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }

        var res;
        try {
            res = await fetch(path, opts);
        } catch (err) {
            throw new Error("Network error - please check your connection.");
        }

        var data = null;
        var text = await res.text();
        if (text) {
            try { data = JSON.parse(text); } catch (_) { data = null; }
        }

        if (!res.ok) {
            var msg = (data && data.error) || "Request failed (" + res.status + ")";
            var e = new Error(msg);
            e.status = res.status;
            throw e;
        }
        return data;
    },
};

/* ============================= UTILITIES ============================== */
function $(selector, root) {
    return (root || document).querySelector(selector);
}

function $$(selector, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(selector));
}

var HTML_ESCAPE_MAP = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

function esc(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/[&<>"']/g, function(ch) {
        return HTML_ESCAPE_MAP[ch] || ch;
    });
}

function toast(message, type) {
    var root = $("#toast-root");
    if (!root) return;
    var el = document.createElement("div");
    el.className = "toast " + (type || "");
    el.textContent = message;
    root.appendChild(el);
    setTimeout(function() {
        el.style.opacity = "0";
        el.style.transition = "opacity .3s";
    }, 2600);
    setTimeout(function() {
        el.remove();
    }, 3000);
}

function openModal(html) {
    $("#modal-content").innerHTML = html;
    $("#modal-root").hidden = false;
}

function closeModal() {
    $("#modal-root").hidden = true;
    $("#modal-content").innerHTML = "";
}

function debounce(fn, ms) {
    var t;
    return function() {
        var args = arguments;
        var ctx = this;
        clearTimeout(t);
        t = setTimeout(function() {
            fn.apply(ctx, args);
        }, ms);
    };
}

/* ============================== STATE ================================= */
var state = {
    user: null,
    view: "dashboard",
    adminLearners: [],
    activities: [],
    currentAssignment: null,
    sim: null,
    simNode: null,
    simDecisions: [],
    simScore: 0,
    simHistory: [],
};

/* ============================== AUTH ================================== */
function bindAuthHandlers() {
    var loginForm = $("#login-form");
    if (loginForm) {
        loginForm.addEventListener("submit", async function(e) {
            e.preventDefault();
            var btn = $("#login-btn");
            var errBox = $("#login-error");
            errBox.hidden = true;
            btn.disabled = true;
            btn.textContent = "Signing in…";
            try {
                var data = await API.request("/api/login", {
                    method: "POST",
                    body: {
                        email: $("#login-email").value,
                        password: $("#login-password").value,
                    },
                });
                state.user = data.user;
                await bootApp();
            } catch (err) {
                errBox.textContent = err.message;
                errBox.hidden = false;
            } finally {
                btn.disabled = false;
                btn.textContent = "Sign in";
            }
        });
    }

    $$(".demo-btn").forEach(function(b) {
        b.addEventListener("click", function() {
            $("#login-email").value = b.dataset.email;
            $("#login-password").value = b.dataset.password;
        });
    });

    var logoutBtn = $("#logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", async function() {
            try { await API.request("/api/logout", { method: "POST" }); } catch (_) {}
            state.user = null;
            location.reload();
        });
    }

    var modalRoot = $("#modal-root");
    if (modalRoot) {
        modalRoot.addEventListener("click", function(e) {
            if (e.target && e.target.classList && e.target.classList.contains("modal-backdrop")) {
                closeModal();
            }
        });
    }

    var menuToggle = $("#menu-toggle");
    if (menuToggle) {
        menuToggle.addEventListener("click", function() {
            var sidebar = $(".sidebar");
            if (sidebar) sidebar.classList.toggle("open");
        });
    }
}

/* ============================== BOOT ================================== */
async function bootApp() {
    try {
        var me = await API.request("/api/me");
        state.user = me.user;
    } catch (_) {
        showLogin();
        return;
    }
    $("#login-view").hidden = true;
    $("#app-view").hidden = false;
    renderUserChip();
    renderNav();
    await route("dashboard");
}

function showLogin() {
    $("#login-view").hidden = false;
    $("#app-view").hidden = true;
}

function renderUserChip() {
    var u = state.user;
    if (!u) return;
    $("#user-chip").innerHTML =
        "<strong>" + esc(u.name) + "</strong><span>" + esc(u.role) + "</span>";
    $("#topbar-user").textContent = u.email;
}

function renderNav() {
    var nav = $("#sidebar-nav");
    if (!nav) return;
    var isAdmin = state.user && state.user.role === "admin";
    var items = isAdmin ?
        [
            { key: "dashboard", label: "Dashboard", icon: "▤" },
            { key: "learners", label: "Learners", icon: "◉" },
            { key: "activities", label: "Activities", icon: "▣" },
            { key: "reports", label: "Reports", icon: "▤" },
        ] :
        [
            { key: "dashboard", label: "My Dashboard", icon: "▤" },
            { key: "history", label: "History", icon: "◷" },
        ];

    nav.innerHTML = items
        .map(function(i) {
            var activeClass = state.view === i.key ? "active" : "";
            return (
                '<a href="#" data-view="' + i.key + '" class="' + activeClass + '">' +
                '<span class="nav-icon">' + i.icon + "</span>" + i.label +
                "</a>"
            );
        })
        .join("");

    $$("#sidebar-nav a").forEach(function(a) {
        a.addEventListener("click", function(e) {
            e.preventDefault();
            route(a.dataset.view);
            var sidebar = $(".sidebar");
            if (sidebar) sidebar.classList.remove("open");
        });
    });
}

async function route(view) {
    state.view = view;
    renderNav();
    var content = $("#content");
    content.innerHTML = '<div class="card"><p class="muted">Loading…</p></div>';
    try {
        if (state.user.role === "admin") {
            if (view === "dashboard") await renderAdminDashboard();
            else if (view === "learners") await renderLearnersView();
            else if (view === "activities") await renderActivitiesView();
            else if (view === "reports") await renderReportsView();
        } else {
            if (view === "dashboard") await renderLearnerDashboard();
            else if (view === "history") await renderHistoryView();
        }
    } catch (err) {
        content.innerHTML =
            '<div class="card"><div class="error-box">' + esc(err.message) + "</div></div>";
    }
}

/* ======================== ADMIN: DASHBOARD =========================== */
async function renderAdminDashboard() {
    $("#page-title").textContent = "Dashboard";
    var stats = await API.request("/api/admin/stats");
    var c = $("#content");
    c.innerHTML =
        '<div class="stat-grid">' +
        statCard("Total learners", stats.total_learners, "registered accounts") +
        statCard("Active learners", stats.active_learners, "currently enabled", "success") +
        statCard("Assigned activities", stats.assigned_activities, "across all learners", "accent") +
        statCard("Completion rate", stats.completion_rate + "%",
            stats.completed_activities + " of " + stats.assigned_activities + " completed", "warning") +
        "</div>" +
        '<div class="card">' +
        '<div class="card-header"><span class="card-title">Completions (last 7 days)</span></div>' +
        renderBarChart(stats.chart) +
        "</div>";
}

function statCard(label, value, sub, tone) {
    tone = tone || "";
    return (
        '<div class="stat-card ' + tone + '">' +
        '<div class="stat-label">' + esc(label) + "</div>" +
        '<div class="stat-value">' + esc(value) + "</div>" +
        '<div class="stat-sub">' + esc(sub) + "</div>" +
        "</div>"
    );
}

function renderBarChart(data) {
    if (!data || !data.length) {
        return '<div class="empty"><div class="empty-icon">▤</div>No completions recorded yet.</div>';
    }
    var max = Math.max.apply(
        null,
        data.map(function(d) { return d.completions; }).concat([1])
    );
    return (
        '<div class="bar-chart">' +
        data.map(function(d) {
            var pct = (d.completions / max) * 100;
            return (
                '<div class="bar-col">' +
                '<div class="bar-value">' + d.completions + "</div>" +
                '<div class="bar" style="height:' + pct + '%"></div>' +
                '<div class="bar-label">' + esc(d.date.slice(5)) + "</div>" +
                "</div>"
            );
        }).join("") +
        "</div>"
    );
}

/* ======================== ADMIN: LEARNERS ============================ */
async function renderLearnersView() {
    $("#page-title").textContent = "Learners";
    var results = await Promise.all([
        API.request("/api/admin/learners"),
        API.request("/api/activities"),
    ]);
    state.adminLearners = results[0].learners;
    state.activities = results[1].activities;

    $("#content").innerHTML =
        '<div class="card">' +
        '<div class="toolbar">' +
        '<input id="learner-search" type="search" placeholder="Search by name or email…" />' +
        '<select id="learner-status">' +
        '<option value="">All statuses</option>' +
        '<option value="active">Active</option>' +
        '<option value="inactive">Inactive</option>' +
        "</select>" +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary btn-sm" id="add-learner-btn">+ Add learner</button>' +
        '<button class="btn btn-ghost btn-sm" id="assign-btn">Assign activity</button>' +
        "</div>" +
        '<div id="learners-table"></div>' +
        "</div>";

    renderLearnersTable();

    $("#learner-search").addEventListener("input", debounce(renderLearnersTable, 250));
    $("#learner-status").addEventListener("change", renderLearnersTable);
    $("#add-learner-btn").addEventListener("click", openAddLearnerModal);
    $("#assign-btn").addEventListener("click", openAssignModal);
}

function renderLearnersTable() {
    var q = (($("#learner-search") && $("#learner-search").value) || "").toLowerCase();
    var status = ($("#learner-status") && $("#learner-status").value) || "";
    var rows = state.adminLearners.filter(function(l) {
        var matchesQ = !q || l.name.toLowerCase().indexOf(q) !== -1 || l.email.toLowerCase().indexOf(q) !== -1;
        var matchesS = !status || (status === "active" ? l.active : !l.active);
        return matchesQ && matchesS;
    });

    var el = $("#learners-table");
    if (!el) return;

    if (!rows.length) {
        el.innerHTML =
            '<div class="empty"><div class="empty-icon">◉</div>No learners match your filters.</div>';
        return;
    }

    var rowsHtml = rows.map(function(l) {
        var badge = l.active ?
            '<span class="badge badge-success">Active</span>' :
            '<span class="badge badge-danger">Inactive</span>';
        var toggleLabel = l.active ? "Deactivate" : "Activate";
        return (
            "<tr>" +
            "<td><strong>" + esc(l.name) + "</strong></td>" +
            "<td>" + esc(l.email) + "</td>" +
            "<td>" + badge + "</td>" +
            "<td>" + l.completed + "/" + l.assignments + " completed</td>" +
            "<td>" +
            '<button class="btn btn-ghost btn-sm" data-action="progress" data-id="' + l.id + '">View</button> ' +
            '<button class="btn btn-ghost btn-sm" data-action="toggle" data-id="' + l.id + '">' +
            toggleLabel +
            "</button>" +
            "</td>" +
            "</tr>"
        );
    }).join("");

    el.innerHTML =
        '<div class="table-wrap"><table>' +
        "<thead><tr>" +
        "<th>Name</th><th>Email</th><th>Status</th><th>Assignments</th><th>Actions</th>" +
        "</tr></thead>" +
        "<tbody>" + rowsHtml + "</tbody>" +
        "</table></div>";

    $$("#learners-table button[data-action]").forEach(function(b) {
        b.addEventListener("click", function() {
            handleLearnerAction(b.dataset.action, Number(b.dataset.id));
        });
    });
}

async function handleLearnerAction(action, id) {
    if (action === "toggle") {
        try {
            var r = await API.request("/api/admin/learners/" + id + "/toggle", { method: "POST" });
            toast("Learner " + (r.active ? "activated" : "deactivated") + ".", "success");
            await route("learners");
        } catch (e) {
            toast(e.message, "error");
        }
    } else if (action === "progress") {
        await showLearnerProgress(id);
    }
}

async function showLearnerProgress(id) {
    try {
        var data = await API.request("/api/admin/learner/" + id + "/progress");
        var rows = data.progress;
        var body;
        if (rows.length) {
            body =
                '<div class="table-wrap" style="margin-top:1rem"><table>' +
                "<thead><tr><th>Activity</th><th>Status</th><th>Score</th></tr></thead>" +
                "<tbody>" +
                rows.map(function(r) {
                    var statusBadge = r.status === "completed" ?
                        '<span class="badge badge-success">Completed</span>' :
                        '<span class="badge badge-neutral">Assigned</span>';
                    var score = r.score != null ? r.score + "/" + r.max_score : "—";
                    return (
                        "<tr>" +
                        "<td>" + esc(r.title) + "</td>" +
                        "<td>" + statusBadge + "</td>" +
                        "<td>" + score + "</td>" +
                        "</tr>"
                    );
                }).join("") +
                "</tbody>" +
                "</table></div>";
        } else {
            body = '<div class="empty">No activities assigned yet.</div>';
        }

        openModal(
            "<h3>" + esc(data.learner.name) + "</h3>" +
            '<p class="muted small">' + esc(data.learner.email) + "</p>" +
            body +
            '<div style="margin-top:1.25rem;text-align:right">' +
            '<button class="btn btn-ghost" onclick="closeModal()">Close</button>' +
            "</div>"
        );
    } catch (e) {
        toast(e.message, "error");
    }
}

function openAddLearnerModal() {
    openModal(
        "<h3>Add learner</h3>" +
        '<form id="add-learner-form" class="form">' +
        '<label for="al-name">Full name</label>' +
        '<input id="al-name" required />' +
        '<label for="al-email">Email</label>' +
        '<input id="al-email" type="email" required />' +
        '<label for="al-pass">Temporary password</label>' +
        '<input id="al-pass" type="password" minlength="8" required />' +
        '<div class="error-box" id="al-error" hidden></div>' +
        '<div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">' +
        '<button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Create learner</button>' +
        "</div>" +
        "</form>"
    );

    $("#add-learner-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        var err = $("#al-error");
        err.hidden = true;
        try {
            await API.request("/api/admin/learners", {
                method: "POST",
                body: {
                    name: $("#al-name").value,
                    email: $("#al-email").value,
                    password: $("#al-pass").value,
                },
            });
            closeModal();
            toast("Learner created.", "success");
            await route("learners");
        } catch (e2) {
            err.textContent = e2.message;
            err.hidden = false;
        }
    });
}

function openAssignModal() {
    var learners = state.adminLearners.filter(function(l) { return l.active; });
    var acts = state.activities;
    if (!learners.length) { toast("Add an active learner first.", "error"); return; }
    if (!acts.length) { toast("No activities available.", "error"); return; }

    var learnerList = learners.map(function(l) {
        return (
            '<label style="display:flex;gap:.5rem;align-items:center;font-weight:400;padding:.25rem 0">' +
            '<input type="checkbox" class="as-learner" value="' + l.id + '" />' +
            "<span>" + esc(l.name) +
            ' <span class="muted small">(' + esc(l.email) + ")</span></span>" +
            "</label>"
        );
    }).join("");

    var activityOptions = acts.map(function(a) {
        return '<option value="' + a.id + '">' + esc(a.title) + "</option>";
    }).join("");

    openModal(
        "<h3>Assign activity</h3>" +
        '<form id="assign-form" class="form">' +
        '<label for="as-activity">Activity</label>' +
        '<select id="as-activity">' + activityOptions + "</select>" +
        '<label style="margin-top:.75rem">Learners</label>' +
        '<div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:.5rem">' +
        learnerList +
        "</div>" +
        '<div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">' +
        '<button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Assign</button>' +
        "</div>" +
        "</form>"
    );

    $("#assign-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        var ids = $$(".as-learner:checked").map(function(c) { return Number(c.value); });
        if (!ids.length) { toast("Select at least one learner.", "error"); return; }
        try {
            var r = await API.request("/api/admin/assign", {
                method: "POST",
                body: { activity_id: Number($("#as-activity").value), learner_ids: ids },
            });
            closeModal();
            toast("Assigned to " + r.assigned + " learner(s).", "success");
            await route("learners");
        } catch (e2) {
            toast(e2.message, "error");
        }
    });
}

/* ======================== ADMIN: ACTIVITIES ========================== */
async function renderActivitiesView() {
    $("#page-title").textContent = "Activities";
    var acts = await API.request("/api/activities");
    state.activities = acts.activities;

    var body;
    if (acts.activities.length) {
        body =
            '<div class="table-wrap"><table>' +
            "<thead><tr><th>Title</th><th>Type</th><th>Difficulty</th><th>Description</th></tr></thead>" +
            "<tbody>" +
            acts.activities.map(function(a) {
                return (
                    "<tr>" +
                    "<td><strong>" + esc(a.title) + "</strong></td>" +
                    '<td><span class="badge badge-brand">' + esc(a.type) + "</span></td>" +
                    "<td>" + esc(a.difficulty) + "</td>" +
                    "<td>" + esc(a.description) + "</td>" +
                    "</tr>"
                );
            }).join("") +
            "</tbody>" +
            "</table></div>";
    } else {
        body = '<div class="empty"><div class="empty-icon">▣</div>No activities yet.</div>';
    }

    $("#content").innerHTML =
        '<div class="card">' +
        '<div class="card-header">' +
        '<span class="card-title">Learning activities</span>' +
        '<button class="btn btn-primary btn-sm" id="new-activity-btn">+ New activity</button>' +
        "</div>" +
        body +
        "</div>";

    $("#new-activity-btn").addEventListener("click", openNewActivityModal);
}

function openNewActivityModal() {
    openModal(
        "<h3>New activity</h3>" +
        '<form id="new-act-form" class="form">' +
        '<label for="na-title">Title</label>' +
        '<input id="na-title" required />' +
        '<label for="na-desc">Description</label>' +
        '<textarea id="na-desc" rows="3" required></textarea>' +
        '<label for="na-diff">Difficulty</label>' +
        '<select id="na-diff">' +
        '<option value="easy">Easy</option>' +
        '<option value="medium" selected>Medium</option>' +
        '<option value="hard">Hard</option>' +
        "</select>" +
        '<div style="display:flex;gap:.5rem;justify-content:flex-end;margin-top:1rem">' +
        '<button type="button" class="btn btn-ghost" onclick="closeModal()">Cancel</button>' +
        '<button type="submit" class="btn btn-primary">Create</button>' +
        "</div>" +
        "</form>"
    );

    $("#new-act-form").addEventListener("submit", async function(e) {
        e.preventDefault();
        try {
            await API.request("/api/admin/activities", {
                method: "POST",
                body: {
                    title: $("#na-title").value,
                    description: $("#na-desc").value,
                    difficulty: $("#na-diff").value,
                },
            });
            closeModal();
            toast("Activity created.", "success");
            await route("activities");
        } catch (e2) {
            toast(e2.message, "error");
        }
    });
}

/* ========================= ADMIN: REPORTS ============================ */
async function renderReportsView() {
    $("#page-title").textContent = "Reports";
    var results = await Promise.all([
        API.request("/api/admin/export"),
        API.request("/api/admin/audit"),
    ]);
    var report = results[0];
    var audit = results[1];

    var reportBody;
    if (report.report.length) {
        reportBody =
            '<div class="table-wrap"><table>' +
            "<thead><tr>" +
            "<th>Learner</th><th>Email</th><th>Activity</th><th>Status</th><th>Score</th><th>Completed</th>" +
            "</tr></thead>" +
            "<tbody>" +
            report.report.map(function(r) {
                var statusBadge = r.status === "completed" ?
                    '<span class="badge badge-success">Completed</span>' :
                    '<span class="badge badge-neutral">Assigned</span>';
                var score = r.score != null ? r.score + "/" + r.max_score : "—";
                var when = r.completed_at ? esc(r.completed_at.slice(0, 10)) : "—";
                return (
                    "<tr>" +
                    "<td>" + esc(r.learner) + "</td>" +
                    "<td>" + esc(r.email) + "</td>" +
                    "<td>" + esc(r.activity) + "</td>" +
                    "<td>" + statusBadge + "</td>" +
                    "<td>" + score + "</td>" +
                    "<td>" + when + "</td>" +
                    "</tr>"
                );
            }).join("") +
            "</tbody>" +
            "</table></div>";
    } else {
        reportBody = '<div class="empty">No assignment data yet.</div>';
    }

    var auditBody;
    if (audit.log.length) {
        auditBody =
            '<div class="table-wrap"><table>' +
            "<thead><tr><th>When</th><th>Action</th><th>Details</th></tr></thead>" +
            "<tbody>" +
            audit.log.slice(0, 20).map(function(l) {
                return (
                    "<tr>" +
                    '<td class="small">' + esc(l.created_at.slice(0, 19).replace("T", " ")) + "</td>" +
                    '<td><span class="badge badge-neutral">' + esc(l.action) + "</span></td>" +
                    '<td class="small muted">' + esc(l.details) + "</td>" +
                    "</tr>"
                );
            }).join("") +
            "</tbody>" +
            "</table></div>";
    } else {
        auditBody = '<div class="empty">No audit entries.</div>';
    }

    $("#content").innerHTML =
        '<div class="card">' +
        '<div class="card-header">' +
        '<span class="card-title">Learner performance report</span>' +
        '<button class="btn btn-ghost btn-sm" id="export-csv">Download CSV</button>' +
        "</div>" +
        reportBody +
        "</div>" +
        '<div class="card">' +
        '<div class="card-header"><span class="card-title">Audit log (recent)</span></div>' +
        auditBody +
        "</div>";

    $("#export-csv").addEventListener("click", function() {
        var rows = [
            ["Learner", "Email", "Activity", "Status", "Score", "Max", "Completed"]
        ];
        report.report.forEach(function(r) {
            rows.push([
                r.learner,
                r.email,
                r.activity,
                r.status,
                r.score == null ? "" : r.score,
                r.max_score == null ? "" : r.max_score,
                r.completed_at || "",
            ]);
        });
        var csv = rows.map(function(row) {
            return row.map(function(cell) {
                return '"' + String(cell).replace(/"/g, '""') + '"';
            }).join(",");
        }).join("\n");
        var blob = new Blob([csv], { type: "text/csv" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "nudle-performance-report.csv";
        a.click();
        URL.revokeObjectURL(url);
        toast("Report downloaded.", "success");
    });
}

/* ======================= LEARNER: DASHBOARD ========================== */
async function renderLearnerDashboard() {
    $("#page-title").textContent = "My Dashboard";
    var data = await API.request("/api/learner/dashboard");
    var s = data.summary;

    var tableBody;
    if (data.assignments.length) {
        tableBody =
            '<div class="table-wrap"><table>' +
            "<thead><tr>" +
            "<th>Activity</th><th>Difficulty</th><th>Status</th><th>Score</th><th></th>" +
            "</tr></thead>" +
            "<tbody>" +
            data.assignments.map(function(a) {
                var statusBadge = a.status === "completed" ?
                    '<span class="badge badge-success">Completed</span>' :
                    '<span class="badge badge-warning">Assigned</span>';
                var score = a.score != null ? a.score + "/" + a.max_score : "—";
                var actionBtn = a.status === "completed" ?
                    '<button class="btn btn-ghost btn-sm" data-view-result="' + a.assignment_id + '">Review</button>' :
                    '<button class="btn btn-primary btn-sm" data-start="' + a.assignment_id + '">Start</button>';
                return (
                    "<tr>" +
                    "<td><strong>" + esc(a.title) + "</strong>" +
                    '<div class="muted small">' + esc(a.description) + "</div></td>" +
                    "<td>" + esc(a.difficulty) + "</td>" +
                    "<td>" + statusBadge + "</td>" +
                    "<td>" + score + "</td>" +
                    "<td>" + actionBtn + "</td>" +
                    "</tr>"
                );
            }).join("") +
            "</tbody>" +
            "</table></div>";
    } else {
        tableBody =
            '<div class="empty"><div class="empty-icon">◷</div>No activities assigned yet. Check back soon!</div>';
    }

    $("#content").innerHTML =
        '<div class="stat-grid">' +
        statCard("Assigned activities", s.total, "in your queue") +
        statCard("Completed", s.completed, "activities finished", "success") +
        statCard("Average score", s.average_score != null ? s.average_score + "%" : "—",
            "across completed activities", "accent") +
        "</div>" +
        '<div class="card">' +
        '<div class="card-header"><span class="card-title">Your activities</span></div>' +
        tableBody +
        "</div>";

    $$("[data-start]").forEach(function(b) {
        b.addEventListener("click", function() {
            startSimulation(Number(b.dataset.start));
        });
    });
    $$("[data-view-result]").forEach(function(b) {
        b.addEventListener("click", function() {
            toast("Result saved in your history.", "");
        });
    });
}

async function renderHistoryView() {
    $("#page-title").textContent = "History";
    var data = await API.request("/api/learner/history");

    var body;
    if (data.history.length) {
        body =
            '<div class="table-wrap"><table>' +
            "<thead><tr><th>Activity</th><th>Score</th><th>Completed</th></tr></thead>" +
            "<tbody>" +
            data.history.map(function(h) {
                return (
                    "<tr>" +
                    "<td>" + esc(h.title) + "</td>" +
                    "<td><strong>" + h.score + "/" + h.max_score + "</strong></td>" +
                    "<td>" + esc(h.completed_at.slice(0, 10)) + "</td>" +
                    "</tr>"
                );
            }).join("") +
            "</tbody>" +
            "</table></div>";
    } else {
        body = '<div class="empty"><div class="empty-icon">◷</div>No history yet.</div>';
    }

    $("#content").innerHTML =
        '<div class="card">' +
        '<div class="card-header"><span class="card-title">Completion history</span></div>' +
        body +
        "</div>";
}

/* ====================== SIMULATION ENGINE ============================ */
async function startSimulation(assignmentId) {
    try {
        var data = await API.request("/api/learner/assignment/" + assignmentId);
        state.currentAssignment = data.assignment;
        state.sim = data.simulation;
        state.simNode = data.simulation.start;
        state.simDecisions = [];
        state.simScore = 0;
        state.simHistory = [];
        renderSimulation();
    } catch (e) {
        toast(e.message, "error");
    }
}

function renderSimulation() {
    var sim = state.sim;
    var node = sim.nodes[state.simNode];
    if (!node) { finishSimulation(); return; }

    var isTerminal = node.terminal || !node.options.length;
    var c = $("#content");

    var progressDots = state.simHistory
        .map(function() { return '<div class="dot filled"></div>'; })
        .join("") +
        '<div class="dot"></div><div class="dot"></div><div class="dot"></div>';

    var scenarioBody;
    if (isTerminal) {
        scenarioBody = '<div id="sim-feedback"></div>';
    } else {
        var opts = node.options.map(function(o, i) {
            return '<button class="sim-option" data-idx="' + i + '">' + esc(o.label) + "</button>";
        }).join("");
        scenarioBody =
            '<div class="sim-options" id="sim-options">' + opts + "</div>" +
            '<div id="sim-feedback"></div>';
    }

    c.innerHTML =
        '<div class="sim-wrap">' +
        '<div class="sim-header">' +
        "<h2>" + esc(sim.title) + "</h2>" +
        "<p>" + esc(sim.intro) + "</p>" +
        '<div class="sim-progress">' + progressDots + "</div>" +
        '<div class="sim-score-pill">Score: ' + state.simScore + " pts</div>" +
        "</div>" +
        '<div class="sim-scenario">' +
        '<div class="sim-prompt">' + esc(node.prompt) + "</div>" +
        scenarioBody +
        "</div>" +
        "</div>";

    if (isTerminal) {
        finishSimulation();
        return;
    }

    $$("#sim-options .sim-option").forEach(function(b) {
        b.addEventListener("click", function() {
            chooseSimOption(Number(b.dataset.idx));
        });
    });
}

function chooseSimOption(idx) {
    var sim = state.sim;
    var node = sim.nodes[state.simNode];
    var opt = node.options[idx];
    if (!opt) return;

    state.simDecisions.push({ option: idx, label: opt.label, points: opt.points });
    state.simScore = Math.max(0, state.simScore + (opt.points || 0));
    state.simHistory.push(opt.label);

    var buttons = $$("#sim-options .sim-option");
    buttons.forEach(function(b, i) {
        b.disabled = true;
        if (i === idx) {
            b.classList.add(opt.points > 0 ? "correct" : "incorrect");
        }
    });

    var tone = opt.points > 0 ? "positive" : opt.points < 0 ? "negative" : "";
    var sign = opt.points >= 0 ? "+" : "";
    $("#sim-feedback").innerHTML =
        '<div class="sim-feedback ' + tone + '">' +
        "<strong>" +
        (opt.points > 0 ? "✔ Correct" : opt.points < 0 ? "✘ Not quite" : "Note") +
        ":</strong> " +
        esc(opt.feedback) +
        " <em>(" + sign + opt.points + " pts)</em>" +
        "</div>";

    state.simNode = opt.next;

    setTimeout(function() {
        var next = state.sim.nodes[state.simNode];
        if (next && (next.terminal || !next.options.length)) {
            finishSimulation();
        } else {
            renderSimulation();
        }
    }, 1600);
}

async function finishSimulation() {
    var aid = state.currentAssignment.id;
    var result;
    try {
        result = await API.request("/api/learner/assignment/" + aid + "/submit", {
            method: "POST",
            body: {
                decisions: state.simDecisions.map(function(d) { return { option: d.option }; }),
            },
        });
    } catch (e) {
        toast("Could not save result: " + e.message, "error");
        result = { score: state.simScore, max_score: 36 };
    }

    var pct = Math.round((result.score / result.max_score) * 100);
    var verdict =
        pct >= 80 ? "Outstanding diagnosis!" :
        pct >= 50 ? "Good effort!" :
        "Keep practising!";
    var emoji = pct >= 80 ? "🏆" : pct >= 50 ? "👍" : "🔧";

    var reviewItems = state.simDecisions.map(function(d) {
        var sign = d.points >= 0 ? "+" : "";
        return (
            "<li>" + esc(d.label) +
            ' <span class="muted small">(' + sign + d.points + " pts)</span></li>"
        );
    }).join("");

    $("#content").innerHTML =
        '<div class="sim-wrap">' +
        '<div class="card sim-complete">' +
        '<div style="font-size:2.5rem">' + emoji + "</div>" +
        "<h2>Simulation complete</h2>" +
        '<p class="muted">' + verdict + "</p>" +
        '<div class="score-big">' + result.score +
        '<span class="score-max">/' + result.max_score + "</span></div>" +
        '<p class="muted">' + pct + "% performance score</p>" +
        '<div class="sim-feedback ' + (pct >= 50 ? "positive" : "negative") +
        '" style="text-align:left;margin-top:1.5rem">' +
        "<strong>Review:</strong>" +
        '<ul style="margin:.4rem 0 0 1.1rem;padding:0">' + reviewItems + "</ul>" +
        "</div>" +
        '<div style="margin-top:1.5rem">' +
        '<button class="btn btn-primary" id="back-to-dashboard">Back to dashboard</button>' +
        "</div>" +
        "</div>" +
        "</div>";

    $("#back-to-dashboard").addEventListener("click", function() {
        route("dashboard");
    });
    state.currentAssignment = null;
}

/* ============================ INIT =================================== */
(async function init() {
    bindAuthHandlers();
    try {
        await bootApp();
    } catch (_) {
        showLogin();
    }
})();