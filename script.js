// CONSTANTS
const STORAGE_KEY = 'medicinetracker_app_state';

// STATE
let appState = {
    medicines: [],   // { id, name, dose, time: 'day' | 'night' }
    records: {},     // { 'YYYY-MM-DD': { medId: true/false } }
    hasSeenWelcome: false
};

let activeTab = 'today';
let currentCalDate = new Date();
let selectedCalDateStr = null;

let editingMedId = null;       // set when editing an existing medicine
let selectedTimeValue = 'day'; // currently selected time in the add/edit form
let pendingDeleteId = null;    // medicine id awaiting delete confirmation

// DATE HELPERS
function getTodayStr() {
    return formatDateStr(new Date());
}

function formatDateStr(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function parseDateStr(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function formatDisplayDate(date) {
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
}

function generateId() {
    return 'med_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// STORAGE
function loadState() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed && typeof parsed === 'object') {
                appState.medicines = Array.isArray(parsed.medicines) ? parsed.medicines : [];
                appState.records = parsed.records || {};
                appState.hasSeenWelcome = !!parsed.hasSeenWelcome;
            }
        }
    } catch (e) {
        console.error('Failed to load state:', e);
    }
}

function saveState() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
    } catch (e) {
        console.error('Failed to save state:', e);
    }
}

// RECORD HELPERS
function getDayRecord(dateStr) {
    if (!appState.records[dateStr]) {
        appState.records[dateStr] = {};
    }
    return appState.records[dateStr];
}

function isMedTaken(dateStr, medId) {
    const record = appState.records[dateStr];
    return !!(record && record[medId]);
}

function setMedTaken(dateStr, medId, value) {
    const record = getDayRecord(dateStr);
    record[medId] = value;
    saveState();
}

function countTakenForDate(dateStr) {
    const record = appState.records[dateStr];
    if (!record) return 0;
    return appState.medicines.reduce((acc, med) => acc + (record[med.id] ? 1 : 0), 0);
}

function isPerfectDay(dateStr) {
    const total = appState.medicines.length;
    if (total === 0) return false;
    return countTakenForDate(dateStr) === total;
}

function getMedicinesByTime(time) {
    return appState.medicines.filter(m => m.time === time);
}

// NAVIGATION
function switchTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
}

function changeMonth(offset) {
    const newMonth = currentCalDate.getMonth() + offset;
    currentCalDate.setDate(1);
    currentCalDate.setMonth(newMonth);

    updateSelectedDateAfterMonthChange();
    renderCalendar();
    renderCalendarDetails(selectedCalDateStr);
}

function updateSelectedDateAfterMonthChange() {
    const now = new Date();
    const isCurrentMonthYear = currentCalDate.getMonth() === now.getMonth() && currentCalDate.getFullYear() === now.getFullYear();

    if (isCurrentMonthYear) {
        selectedCalDateStr = getTodayStr();
    } else {
        const lastDay = new Date(currentCalDate.getFullYear(), currentCalDate.getMonth() + 1, 0);
        selectedCalDateStr = formatDateStr(lastDay);
    }
}

// STREAKS (used for the "Best Streak" stat)
function calculateBestStreak() {
    const todayStr = getTodayStr();
    let bestStreak = 0;

    const sortedDates = Object.keys(appState.records)
        .filter(d => d <= todayStr)
        .sort();

    let tempStreak = 0;
    let prevDate = null;

    for (const dateStr of sortedDates) {
        if (isPerfectDay(dateStr)) {
            if (prevDate) {
                const diffDays = Math.round((parseDateStr(dateStr) - parseDateStr(prevDate)) / (1000 * 60 * 60 * 24));
                tempStreak = diffDays === 1 ? tempStreak + 1 : 1;
            } else {
                tempStreak = 1;
            }
            prevDate = dateStr;
            if (tempStreak > bestStreak) bestStreak = tempStreak;
        } else {
            tempStreak = 0;
            prevDate = null;
        }
    }

    return bestStreak;
}

// RENDER: HEADER DATE
function renderHeaderDate() {
    document.getElementById('current-date-text').textContent = formatDisplayDate(new Date());
}

// RENDER: TODAY TRACKER
function renderMedRow(med, dateStr, editable) {
    const isTaken = isMedTaken(dateStr, med.id);

    const row = document.createElement('div');
    row.className = `med-row ${isTaken ? 'completed' : ''}`;

    const doseHtml = med.dose ? `<span class="med-dose">${escapeHtml(med.dose)}</span>` : '';

    row.innerHTML = `
        <div class="med-main">
            <div class="med-check-btn">
                <svg class="med-check-icon" viewBox="0 0 24 24">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
            </div>
            <div class="med-info">
                <span class="med-name">${escapeHtml(med.name)}</span>
                ${doseHtml}
            </div>
        </div>
        ${editable ? `
        <button class="med-edit-btn" aria-label="Edit ${escapeHtml(med.name)}">
            <svg class="med-edit-icon" viewBox="0 0 24 24">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
            </svg>
        </button>` : ''}
    `;

    row.querySelector('.med-main').addEventListener('click', () => {
        setMedTaken(dateStr, med.id, !isMedTaken(dateStr, med.id));
        renderAll();
    });

    if (editable) {
        row.querySelector('.med-edit-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openMedModal(med);
        });
    }

    return row;
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function renderTodayTracker() {
    const todayStr = getTodayStr();
    const totalMeds = appState.medicines.length;
    const takenCount = countTakenForDate(todayStr);
    const percentage = totalMeds > 0 ? Math.round((takenCount / totalMeds) * 100) : 0;

    document.getElementById('progress-count').textContent = `${takenCount} of ${totalMeds}`;
    document.getElementById('progress-percentage').textContent = `${percentage}%`;
    document.getElementById('progress-bar-fill').style.width = `${percentage}%`;

    const dayList = document.getElementById('day-list');
    const nightList = document.getElementById('night-list');
    dayList.innerHTML = '';
    nightList.innerHTML = '';

    const dayMeds = getMedicinesByTime('day');
    const nightMeds = getMedicinesByTime('night');

    dayMeds.forEach(med => dayList.appendChild(renderMedRow(med, todayStr, true)));
    nightMeds.forEach(med => nightList.appendChild(renderMedRow(med, todayStr, true)));

    document.getElementById('day-empty').classList.toggle('hidden', dayMeds.length > 0);
    document.getElementById('night-empty').classList.toggle('hidden', nightMeds.length > 0);
}

// RENDER: CALENDAR WITH CIRCULAR PROGRESS RINGS
function renderCalendar() {
    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();

    const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    document.getElementById('calendar-month-year').textContent = `${monthNames[month]} ${year}`;

    const daysGrid = document.getElementById('calendar-days-grid');
    daysGrid.innerHTML = '';

    const firstDay = new Date(year, month, 1).getDay();
    const offset = firstDay === 0 ? 6 : firstDay - 1; // Mon=0
    const totalDays = new Date(year, month + 1, 0).getDate();
    const todayStr = getTodayStr();
    const totalMeds = appState.medicines.length;

    for (let i = 0; i < offset; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-cell empty';
        daysGrid.appendChild(emptyCell);
    }

    const circumference = 2 * Math.PI * 14;

    for (let day = 1; day <= totalDays; day++) {
        const cellDate = new Date(year, month, day);
        const dateStr = formatDateStr(cellDate);
        const count = countTakenForDate(dateStr);

        const isFuture = dateStr > todayStr;
        const cell = document.createElement('div');
        cell.className = 'cal-cell';
        if (dateStr === todayStr) cell.classList.add('today');
        if (selectedCalDateStr === dateStr) cell.classList.add('selected');

        const ratio = totalMeds > 0 ? count / totalMeds : 0;
        const dashOffset = isFuture ? circumference : circumference - ratio * circumference;

        cell.innerHTML = `
            <svg class="cal-ring-svg" viewBox="0 0 36 36">
                <circle class="cal-ring-bg" cx="18" cy="18" r="14" />
                <circle class="cal-ring-fill" cx="18" cy="18" r="14"
                    stroke-dasharray="${circumference}"
                    stroke-dashoffset="${dashOffset}" />
            </svg>
            <span class="cal-cell-num">${day}</span>
        `;

        if (!isFuture) {
            cell.addEventListener('click', () => {
                selectedCalDateStr = dateStr;
                renderCalendar();
                renderCalendarDetails(dateStr);
            });
        } else {
            cell.style.opacity = '0.3';
            cell.style.cursor = 'default';
        }

        daysGrid.appendChild(cell);
    }
}

// RENDER: EDITABLE PAST DAY DETAILS
function renderCalendarDetails(dateStr) {
    const detailsContainer = document.getElementById('calendar-day-details');
    if (!dateStr) {
        detailsContainer.classList.add('hidden');
        return;
    }

    detailsContainer.classList.remove('hidden');

    const d = parseDateStr(dateStr);
    document.getElementById('details-date-title').textContent = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

    const totalMeds = appState.medicines.length;
    const takenCount = countTakenForDate(dateStr);
    document.getElementById('details-summary').textContent = `${takenCount} of ${totalMeds}`;

    const listEl = document.getElementById('details-meds-list');
    listEl.innerHTML = '';

    appState.medicines.forEach(med => {
        const isDone = isMedTaken(dateStr, med.id);
        const row = document.createElement('div');
        row.className = `detail-row ${isDone ? 'completed' : ''}`;

        const doseHtml = med.dose ? `<span class="detail-dose">${escapeHtml(med.dose)}</span>` : '';
        const timeLabel = med.time === 'night' ? '🌙' : '☀️';

        row.innerHTML = `
            <div class="detail-name-group">
                <span class="detail-name">${timeLabel} ${escapeHtml(med.name)}</span>
                ${doseHtml}
            </div>
            <span class="detail-status">${isDone ? '✓ Taken' : '○ Missed'}</span>
        `;

        row.addEventListener('click', () => {
            setMedTaken(dateStr, med.id, !isMedTaken(dateStr, med.id));
            renderAll();
        });

        listEl.appendChild(row);
    });

    document.getElementById('details-empty').classList.toggle('hidden', appState.medicines.length > 0);
}

// RENDER: OVERVIEW STATISTICS
function renderStatistics() {
    const todayStr = getTodayStr();
    let totalTaken = 0;
    let perfectDaysCount = 0;

    Object.keys(appState.records).forEach(dateStr => {
        if (dateStr <= todayStr) {
            totalTaken += countTakenForDate(dateStr);
            if (isPerfectDay(dateStr)) perfectDaysCount++;
        }
    });

    document.getElementById('stat-total').textContent = totalTaken;
    document.getElementById('stat-perfect-days').textContent = perfectDaysCount;
    document.getElementById('stat-best-streak').textContent = calculateBestStreak();

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const daysPassedInMonth = now.getDate();
    const totalMeds = appState.medicines.length;

    let monthTaken = 0;
    for (let i = 1; i <= daysPassedInMonth; i++) {
        const d = new Date(currentYear, currentMonth, i);
        monthTaken += countTakenForDate(formatDateStr(d));
    }

    const monthPossible = daysPassedInMonth * totalMeds;
    const monthRate = monthPossible > 0 ? Math.round((monthTaken / monthPossible) * 100) : 0;

    document.getElementById('stat-month-rate').textContent = `${monthRate}%`;
}

function renderAll() {
    renderHeaderDate();
    renderTodayTracker();
    renderCalendar();
    if (selectedCalDateStr) renderCalendarDetails(selectedCalDateStr);
    renderStatistics();
}

// ADD / EDIT MEDICINE MODAL
function openMedModal(med) {
    const modal = document.getElementById('med-modal');
    const title = document.getElementById('med-modal-title');
    const nameInput = document.getElementById('med-name-input');
    const doseInput = document.getElementById('med-dose-input');
    const deleteBtn = document.getElementById('med-delete-btn');
    const errorEl = document.getElementById('med-modal-error');

    errorEl.classList.add('hidden');

    if (med) {
        editingMedId = med.id;
        title.textContent = 'Edit Medicine';
        nameInput.value = med.name;
        doseInput.value = med.dose || '';
        setSelectedTime(med.time);
        deleteBtn.classList.remove('hidden');
    } else {
        editingMedId = null;
        title.textContent = 'Add Medicine';
        nameInput.value = '';
        doseInput.value = '';
        setSelectedTime('day');
        deleteBtn.classList.add('hidden');
    }

    modal.classList.remove('hidden');
    nameInput.focus();
}

function closeMedModal() {
    document.getElementById('med-modal').classList.add('hidden');
    editingMedId = null;
}

function setSelectedTime(time) {
    selectedTimeValue = time;
    document.getElementById('time-btn-day').classList.toggle('active', time === 'day');
    document.getElementById('time-btn-night').classList.toggle('active', time === 'night');
}

function saveMedFromModal() {
    const nameInput = document.getElementById('med-name-input');
    const doseInput = document.getElementById('med-dose-input');
    const errorEl = document.getElementById('med-modal-error');

    const name = nameInput.value.trim();
    const dose = doseInput.value.trim();

    if (!name) {
        errorEl.classList.remove('hidden');
        nameInput.focus();
        return;
    }
    errorEl.classList.add('hidden');

    if (editingMedId) {
        const med = appState.medicines.find(m => m.id === editingMedId);
        if (med) {
            med.name = name;
            med.dose = dose;
            med.time = selectedTimeValue;
        }
    } else {
        appState.medicines.push({
            id: generateId(),
            name,
            dose,
            time: selectedTimeValue
        });
    }

    saveState();
    closeMedModal();
    renderAll();
}

// DELETE CONFIRMATION
function openConfirmModal(medId) {
    pendingDeleteId = medId;
    document.getElementById('confirm-modal').classList.remove('hidden');
}

function closeConfirmModal() {
    pendingDeleteId = null;
    document.getElementById('confirm-modal').classList.add('hidden');
}

function confirmDeleteMedicine() {
    if (pendingDeleteId) {
        appState.medicines = appState.medicines.filter(m => m.id !== pendingDeleteId);
        saveState();
    }
    closeConfirmModal();
    closeMedModal();
    renderAll();
}

// WELCOME MODAL LOGIC
function checkWelcomeModal() {
    const modal = document.getElementById('welcome-modal');
    if (modal && !appState.hasSeenWelcome) {
        modal.classList.remove('hidden');
    }
}

function setupModalEventListeners() {
    const welcomeModal = document.getElementById('welcome-modal');
    const getStartedBtn = document.getElementById('modal-get-started');

    if (getStartedBtn) {
        getStartedBtn.addEventListener('click', () => {
            appState.hasSeenWelcome = true;
            saveState();
            welcomeModal.classList.add('hidden');
        });
    }

    document.getElementById('add-med-btn').addEventListener('click', () => openMedModal(null));
    document.getElementById('med-cancel-btn').addEventListener('click', closeMedModal);
    document.getElementById('med-save-btn').addEventListener('click', saveMedFromModal);

    document.getElementById('time-btn-day').addEventListener('click', () => setSelectedTime('day'));
    document.getElementById('time-btn-night').addEventListener('click', () => setSelectedTime('night'));

    document.getElementById('med-delete-btn').addEventListener('click', () => {
        if (editingMedId) openConfirmModal(editingMedId);
    });

    document.getElementById('confirm-cancel-btn').addEventListener('click', closeConfirmModal);
    document.getElementById('confirm-delete-btn').addEventListener('click', confirmDeleteMedicine);

    // Close modals when tapping the dark overlay itself (not the card)
    [document.getElementById('med-modal'), document.getElementById('confirm-modal')].forEach(overlay => {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                if (overlay.id === 'med-modal') closeMedModal();
                if (overlay.id === 'confirm-modal') closeConfirmModal();
            }
        });
    });
}

function setupEventListeners() {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
    document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
}

// INITIALIZATION
document.addEventListener('DOMContentLoaded', () => {
    loadState();
    setupEventListeners();
    setupModalEventListeners();

    selectedCalDateStr = getTodayStr();
    renderAll();
    checkWelcomeModal();
});
