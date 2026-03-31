/**
 * DOABLE — script.js
 * Pure vanilla JS. No frameworks, no build step.
 *
 * Architecture: "State → Render" pattern.
 * All UI is rebuilt from a central `state` object
 * every time data changes. localStorage is the only
 * persistence layer.
 */

// ─────────────────────────────────────────────────────────
// 1. STATE
//    Single source of truth for the entire application.
// ─────────────────────────────────────────────────────────

const state = {
  tasks:        [],          // Array of task objects
  filter:       'all',       // 'all' | 'pending' | 'completed' | 'label:<value>'
  sort:         'created',   // 'created' | 'duedate' | 'priority' | 'alpha'
  editingId:    null,        // ID of the task being edited, or null
};

const STORAGE_KEY = 'doable_tasks_v1';

// Priority weight map — used for sorting
const PRIORITY_WEIGHT = { high: 1, medium: 2, low: 3 };


// ─────────────────────────────────────────────────────────
// 2. LOCALSTORAGE — load & save
// ─────────────────────────────────────────────────────────

/** Read persisted tasks from localStorage into state on startup. */
function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    state.tasks = raw ? JSON.parse(raw) : [];
  } catch (err) {
    console.warn('Could not parse saved tasks; starting fresh.', err);
    state.tasks = [];
  }
}

/** Write current state.tasks to localStorage after every mutation. */
function saveToStorage() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.tasks));
}


// ─────────────────────────────────────────────────────────
// 3. TASK CRUD OPERATIONS
// ─────────────────────────────────────────────────────────

/**
 * Build a new task object from raw form values.
 * @param {object} fields - { title, dueDate, priority, label }
 * @returns {object} Fully-formed task object.
 */
function createTask({ title, dueDate, priority, label }) {
  return {
    id:        generateId(),
    title:     title.trim(),
    dueDate:   dueDate  || null,
    priority:  priority || 'medium',
    label:     label.trim() || null,
    completed: false,
    createdAt: Date.now(),
  };
}

/**
 * Add a new task to state, persist, and re-render.
 * @param {object} fields
 */
function addTask(fields) {
  const task = createTask(fields);
  state.tasks.unshift(task); // newest first
  saveToStorage();
  renderAll();
  toast(`Added: "${truncate(task.title, 32)}"`, 'success');
}

/**
 * Update an existing task's editable fields.
 * @param {string} id - Task ID to update.
 * @param {object} fields
 */
function updateTask(id, fields) {
  state.tasks = state.tasks.map(t =>
    t.id === id
      ? {
          ...t,
          title:    fields.title.trim(),
          dueDate:  fields.dueDate  || null,
          priority: fields.priority,
          label:    fields.label.trim() || null,
        }
      : t
  );
  saveToStorage();
  renderAll();
  toast('Task updated', 'success');
}

/**
 * Toggle the completed / pending status of a task.
 * @param {string} id
 */
function toggleComplete(id) {
  state.tasks = state.tasks.map(t =>
    t.id === id ? { ...t, completed: !t.completed } : t
  );
  saveToStorage();
  renderAll();
}

/**
 * Permanently delete a task.
 * @param {string} id
 */
function deleteTask(id) {
  const task = state.tasks.find(t => t.id === id);
  state.tasks = state.tasks.filter(t => t.id !== id);
  saveToStorage();
  renderAll();
  if (task) toast(`Deleted: "${truncate(task.title, 32)}"`, 'delete');
}


// ─────────────────────────────────────────────────────────
// 4. FILTERING & SORTING
// ─────────────────────────────────────────────────────────

/**
 * Filter the task list based on state.filter.
 * @param {object[]} list
 * @returns {object[]}
 */
function applyFilter(list) {
  const f = state.filter;
  if (f === 'all')       return list;
  if (f === 'pending')   return list.filter(t => !t.completed);
  if (f === 'completed') return list.filter(t =>  t.completed);
  // Label filter — encoded as "label:<value>"
  if (f.startsWith('label:')) {
    const lbl = f.slice(6).toLowerCase();
    return list.filter(t => t.label && t.label.toLowerCase() === lbl);
  }
  return list;
}

/**
 * Sort the task list based on state.sort.
 * @param {object[]} list
 * @returns {object[]} New sorted array (does not mutate input).
 */
function applySort(list) {
  const sorted = [...list]; // avoid mutating state.tasks directly
  switch (state.sort) {
    case 'duedate':
      // Tasks with no due date sink to the bottom
      sorted.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return 0;
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return new Date(a.dueDate) - new Date(b.dueDate);
      });
      break;
    case 'priority':
      sorted.sort((a, b) =>
        (PRIORITY_WEIGHT[a.priority] ?? 2) - (PRIORITY_WEIGHT[b.priority] ?? 2)
      );
      break;
    case 'alpha':
      sorted.sort((a, b) =>
        a.title.toLowerCase().localeCompare(b.title.toLowerCase())
      );
      break;
    case 'created':
    default:
      sorted.sort((a, b) => b.createdAt - a.createdAt);
      break;
  }
  return sorted;
}

/** Return the visible (filtered + sorted) task list. */
function getVisibleTasks() {
  return applySort(applyFilter(state.tasks));
}


// ─────────────────────────────────────────────────────────
// 5. RENDER — DOM output
//    All DOM writes live here; logic stays in sections 3–4.
// ─────────────────────────────────────────────────────────

/** Master render function — call this after any state change. */
function renderAll() {
  renderStats();
  renderLabels();
  renderTasks();
  syncFilterButtons();
  syncSortButtons();
  updateBoardHeader();
}

/** Update the stat chips and progress bar. */
function renderStats() {
  const total     = state.tasks.length;
  const done      = state.tasks.filter(t => t.completed).length;
  const pending   = total - done;
  const pct       = total > 0 ? Math.round((done / total) * 100) : 0;

  $('#statTotal').textContent   = total;
  $('#statPending').textContent = pending;
  $('#statDone').textContent    = done;

  const fill = $('#progressFill');
  const bar  = $('#progressBar');
  fill.style.width = pct + '%';
  bar.setAttribute('aria-valuenow', pct);
  $('#progressLabel').textContent = `${pct}% complete`;
}

/** Build the dynamic label filter buttons in the sidebar. */
function renderLabels() {
  const container = $('#labelsList');

  // Collect unique, non-empty labels from all tasks
  const labels = [...new Set(
    state.tasks
      .map(t => t.label)
      .filter(Boolean)
  )].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

  if (labels.length === 0) {
    container.innerHTML = '<span class="no-labels-hint">No labels yet</span>';
    return;
  }

  container.innerHTML = labels.map(lbl => {
    const isActive = state.filter === `label:${lbl}`;
    return `
      <button
        class="label-filter-btn ${isActive ? 'active' : ''}"
        data-label="${escapeHtml(lbl)}"
        aria-pressed="${isActive}"
      >
        <span class="label-dot" aria-hidden="true"></span>
        ${escapeHtml(lbl)}
      </button>
    `;
  }).join('');

  // Attach click handlers for each label button
  container.querySelectorAll('.label-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lbl = btn.dataset.label;
      state.filter = `label:${lbl}`;
      renderAll();
    });
  });
}

/** Render the task cards grid (or empty state). */
function renderTasks() {
  const grid      = $('#taskGrid');
  const emptyEl   = $('#emptyState');
  const visible   = getVisibleTasks();

  if (visible.length === 0) {
    grid.innerHTML = '';
    emptyEl.classList.remove('hidden');
    updateEmptyState();
    return;
  }

  emptyEl.classList.add('hidden');

  // Build HTML for all visible tasks
  grid.innerHTML = visible.map(task => buildCardHTML(task)).join('');

  // Attach event listeners to the freshly-rendered cards
  grid.querySelectorAll('.task-card').forEach(card => {
    const id = card.dataset.id;

    // Checkbox: toggle complete
    card.querySelector('.card-checkbox').addEventListener('click', () => toggleComplete(id));

    // Edit button
    card.querySelector('.card-btn--edit').addEventListener('click', () => openEditModal(id));

    // Delete button
    card.querySelector('.card-btn--delete').addEventListener('click', () => {
      if (confirm('Delete this task?')) deleteTask(id);
    });
  });
}

/**
 * Build the HTML string for a single task card.
 * @param {object} task
 * @returns {string} HTML string.
 */
function buildCardHTML(task) {
  const isDone    = task.completed;
  const dueInfo   = task.dueDate ? getDueInfo(task.dueDate, isDone) : null;

  // Priority badge
  const priLabel  = task.priority.charAt(0).toUpperCase() + task.priority.slice(1);
  const priBadge  = `<span class="badge badge-priority badge-priority--${task.priority}">${priLabel}</span>`;

  // Label badge
  const lblBadge  = task.label
    ? `<span class="badge badge-label">${escapeHtml(task.label)}</span>`
    : '';

  // Due date badge
  const dueBadge  = dueInfo
    ? `<span class="badge-due ${dueInfo.cls}" title="${task.dueDate}">
         <span class="badge-due-icon" aria-hidden="true">📅</span>
         ${escapeHtml(dueInfo.text)}
       </span>`
    : '';

  return `
    <article
      class="task-card ${isDone ? 'is-done' : ''}"
      data-id="${task.id}"
      data-priority="${task.priority}"
      role="listitem"
      aria-label="${escapeHtml(task.title)}"
    >
      <div class="card-top">
        <button
          class="card-checkbox"
          aria-label="${isDone ? 'Mark as pending' : 'Mark as complete'}"
          aria-pressed="${isDone}"
          title="${isDone ? 'Mark pending' : 'Mark complete'}"
        >
          ${isDone ? '<span class="check-mark" aria-hidden="true">✔</span>' : ''}
        </button>
        <span class="card-title">${escapeHtml(task.title)}</span>
      </div>
      <div class="card-meta">
        ${priBadge}
        ${lblBadge}
        ${dueBadge}
      </div>
      <div class="card-actions">
        <button class="card-btn card-btn--edit"   aria-label="Edit task">Edit</button>
        <button class="card-btn card-btn--delete" aria-label="Delete task">Delete</button>
      </div>
    </article>
  `;
}

/**
 * Calculate a human-readable due-date label and CSS class.
 * @param {string} dueDateStr - ISO date string e.g. "2025-06-15"
 * @param {boolean} isDone
 * @returns {{ text: string, cls: string }}
 */
function getDueInfo(dueDateStr, isDone) {
  const due   = new Date(dueDateStr + 'T00:00:00'); // local midnight
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff  = Math.round((due - today) / (1000 * 60 * 60 * 24));

  let text, cls = '';

  if (diff < 0)          { text = `Overdue ${Math.abs(diff)}d`;  cls = isDone ? '' : 'is-overdue'; }
  else if (diff === 0)   { text = 'Due today';                    cls = isDone ? '' : 'is-soon'; }
  else if (diff === 1)   { text = 'Tomorrow';                     cls = isDone ? '' : 'is-soon'; }
  else if (diff <= 7)    { text = `In ${diff} days`;              cls = ''; }
  else {
    // Format as "Jun 15"
    text = due.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  return { text, cls };
}

/** Set board title and subtitle based on current filter. */
function updateBoardHeader() {
  const titleMap = {
    all:       ['All Tasks',   'Everything in one place'],
    pending:   ['Pending',     'Tasks still in progress'],
    completed: ['Completed',   'Well done — keep it up!'],
  };
  let title, subtitle;
  if (state.filter.startsWith('label:')) {
    const lbl = state.filter.slice(6);
    title    = lbl;
    subtitle = `Filtered by label`;
  } else {
    [title, subtitle] = titleMap[state.filter] ?? ['Tasks', ''];
  }
  $('#boardTitle').textContent    = title;
  $('#boardSubtitle').textContent = subtitle;
}

/**
 * Update the empty-state message depending on the active filter.
 * (e.g. "No completed tasks" vs "No tasks here")
 */
function updateEmptyState() {
  const msgMap = {
    all:       ['Nothing here yet',     'Add your first task and start making progress.\nOne step at a time.'],
    pending:   ['All caught up!',        'No pending tasks. Time to celebrate.'],
    completed: ['Nothing completed yet', 'Complete a task and it will show up here.'],
  };
  let [title, body] = state.filter.startsWith('label:')
    ? ['No tasks with this label', 'No tasks found for this label.']
    : (msgMap[state.filter] ?? ['Nothing here', '']);

  $('#emptyTitle').textContent = title;
  $('#emptyBody').innerHTML    = body.replace(/\n/g, '<br/>');
}

/** Highlight the active filter button. */
function syncFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(btn => {
    const isActive = btn.dataset.filter === state.filter;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-current', isActive ? 'true' : 'false');
  });
}

/** Highlight the active sort button. */
function syncSortButtons() {
  document.querySelectorAll('.sort-btn').forEach(btn => {
    const isActive = btn.dataset.sort === state.sort;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
  });
}


// ─────────────────────────────────────────────────────────
// 6. MODAL — open, close, submit
// ─────────────────────────────────────────────────────────

const overlay    = $('#modalOverlay');
const form       = $('#taskForm');
const modalTitle = $('#modalHeading');

/** Open the modal in "add new task" mode. */
function openAddModal() {
  state.editingId = null;
  modalTitle.textContent = 'New Task';
  form.reset();
  clearFormErrors();
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => $('#taskTitle').focus());
}

/**
 * Open the modal pre-filled with an existing task for editing.
 * @param {string} id - Task ID to edit.
 */
function openEditModal(id) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;

  state.editingId = id;
  modalTitle.textContent = 'Edit Task';

  // Pre-fill form fields
  $('#taskId').value       = task.id;
  $('#taskTitle').value    = task.title;
  $('#taskDue').value      = task.dueDate || '';
  $('#taskPriority').value = task.priority;
  $('#taskLabel').value    = task.label || '';

  clearFormErrors();
  overlay.classList.remove('hidden');
  requestAnimationFrame(() => $('#taskTitle').focus());
}

/** Close the modal and reset state. */
function closeModal() {
  overlay.classList.add('hidden');
  state.editingId = null;
  form.reset();
  clearFormErrors();
}

/**
 * Handle form submission for both add and edit.
 * Validates input before acting.
 */
function handleFormSubmit(e) {
  e.preventDefault();

  const titleInput = $('#taskTitle');
  const title      = titleInput.value.trim();

  // Validation: title is required
  if (!title) {
    showFieldError(titleInput, 'titleError');
    titleInput.focus();
    return;
  }
  clearFormErrors();

  const fields = {
    title,
    dueDate:  $('#taskDue').value,
    priority: $('#taskPriority').value,
    label:    $('#taskLabel').value,
  };

  if (state.editingId) {
    updateTask(state.editingId, fields);
  } else {
    addTask(fields);
  }
  closeModal();
}

/** Mark a field as invalid and show its error message. */
function showFieldError(inputEl, errorId) {
  inputEl.classList.add('field-error-state');
  const err = $(`#${errorId}`);
  if (err) err.classList.remove('hidden');
  inputEl.setAttribute('aria-invalid', 'true');
}

/** Remove all validation error states from the form. */
function clearFormErrors() {
  form.querySelectorAll('.field-input').forEach(el => {
    el.classList.remove('field-error-state');
    el.removeAttribute('aria-invalid');
  });
  form.querySelectorAll('.field-error').forEach(el => el.classList.add('hidden'));
}


// ─────────────────────────────────────────────────────────
// 7. TOAST NOTIFICATIONS
// ─────────────────────────────────────────────────────────

let toastTimer = null;

/**
 * Display a temporary toast message.
 * @param {string} message
 * @param {'default'|'success'|'delete'} type
 */
function toast(message, type = 'default') {
  const el = $('#toast');
  clearTimeout(toastTimer);

  el.textContent = message;
  el.className   = `toast toast--${type}`;
  el.classList.remove('hidden');

  toastTimer = setTimeout(() => {
    el.classList.add('toast--exit');
    el.addEventListener('animationend', () => {
      el.classList.add('hidden');
      el.classList.remove('toast--exit');
    }, { once: true });
  }, 2600);
}


// ─────────────────────────────────────────────────────────
// 8. MOBILE SIDEBAR
// ─────────────────────────────────────────────────────────

const sidebar        = $('#sidebar');
const sidebarOverlay = $('#sidebarOverlay');
const toggleBtn      = $('#sidebarToggle');

function openSidebar() {
  sidebar.classList.add('is-open');
  sidebarOverlay.classList.add('is-visible');
  toggleBtn.classList.add('is-open');
  toggleBtn.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  sidebar.classList.remove('is-open');
  sidebarOverlay.classList.remove('is-visible');
  toggleBtn.classList.remove('is-open');
  toggleBtn.setAttribute('aria-expanded', 'false');
}


// ─────────────────────────────────────────────────────────
// 9. EVENT WIRING
//    Attach all event listeners after the DOM is ready.
// ─────────────────────────────────────────────────────────

function wireEvents() {
  // ── Modal open/close ──
  $('#openModalBtn').addEventListener('click', openAddModal);
  $('#openModalBtnMobile').addEventListener('click', openAddModal);
  $('#emptyAddBtn').addEventListener('click', openAddModal);
  $('#closeModalBtn').addEventListener('click', closeModal);
  $('#cancelModalBtn').addEventListener('click', closeModal);

  // Close modal on backdrop click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) closeModal();
  });

  // Form submission
  form.addEventListener('submit', handleFormSubmit);

  // Clear validation error on input
  $('#taskTitle').addEventListener('input', () => {
    clearFormErrors();
  });

  // ── Filter buttons ──
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.filter = btn.dataset.filter;
      renderAll();
      closeSidebar(); // auto-close on mobile after filter
    });
  });

  // ── Sort buttons ──
  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.sort = btn.dataset.sort;
      renderAll();
    });
  });

  // ── Mobile sidebar toggle ──
  toggleBtn.addEventListener('click', () => {
    if (sidebar.classList.contains('is-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  });
  sidebarOverlay.addEventListener('click', closeSidebar);

  // ── Keyboard: Escape closes modal / sidebar ──
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (!overlay.classList.contains('hidden')) closeModal();
      else if (sidebar.classList.contains('is-open'))  closeSidebar();
    }
  });
}


// ─────────────────────────────────────────────────────────
// 10. UTILITY HELPERS
// ─────────────────────────────────────────────────────────

/**
 * Shorthand for document.querySelector.
 * @param {string} sel - CSS selector.
 * @returns {HTMLElement}
 */
function $(sel) { return document.querySelector(sel); }

/**
 * Generate a simple unique ID using crypto.randomUUID if available,
 * falling back to a timestamp + random string.
 * @returns {string}
 */
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

/**
 * Truncate a string to a max length, appending "…" if cut.
 * @param {string} str
 * @param {number} max
 * @returns {string}
 */
function truncate(str, max) {
  return str.length <= max ? str : str.slice(0, max) + '…';
}

/**
 * Escape HTML special characters to prevent XSS when
 * inserting user content into innerHTML.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}


// ─────────────────────────────────────────────────────────
// 11. INIT — bootstrap the app
// ─────────────────────────────────────────────────────────

(function init() {
  loadFromStorage(); // Hydrate state.tasks from localStorage
  wireEvents();      // Attach all DOM event listeners
  renderAll();       // Do the first render from state
})();
