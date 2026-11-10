const defaultCategories = [
  { name: 'Food', label: 'Food & Groceries', description: 'Fresh groceries, snacks, and meals.' },
  { name: 'Transport', label: 'Transport', description: 'Fuel, rides, transit, and commute costs.' },
  { name: 'Housing', label: 'Housing', description: 'Rent, utilities, and upkeep costs.' },
  { name: 'Entertainment', label: 'Entertainment', description: 'Streaming, outings, and hobbies.' },
  { name: 'Savings', label: 'Savings', description: 'Emergency and future savings.' },
  { name: 'Utilities', label: 'Utilities', description: 'Electricity, water, and internet costs.' },
  { name: 'Other', label: 'Other', description: 'Unexpected or uncategorized spending.' }
];

let categories = [...defaultCategories];
let displayName = 'Michael';
let monthlyBudget = 1000;
const supportedCurrencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'NZD', 'JPY', 'CNY', 'INR', 'NGN', 'KES', 'ZAR', 'GHS', 'UGX', 'TZS', 'RWF', 'AED', 'CHF', 'SGD'];
let currency = 'USD';
let selectedDate = toISO(new Date());
let currentCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let selectedExpenseId = null;
let editingExpenseId = null;
let expenses = [];
let recurringSchedules = [];
let account = null;
let renderQueued = false;
let lastBudgetNotice = null;
let activeToastTimeout = null;
let searchResultsOpen = false;

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

async function loadDashboardState() {
  try {
    let accountResponse;
    try {
      accountResponse = await fetch('/api/auth/me');
    } catch (error) {
      throw new Error('Unable to connect to SpendWise. In the project terminal, run `npm start`, then retry.');
    }
    if (accountResponse.status === 401) {
      showAuthScreen('Sign in or create an account to continue.');
      return;
    }
    if (!accountResponse.ok) throw new Error('Unable to verify your account.');
    account = (await accountResponse.json()).user;
    document.getElementById('account-email').textContent = account.email;
    document.getElementById('sidebar-account-email').textContent = account.email;

    const [settings, loadedExpenses, loadedCategories, loadedRecurring] = await Promise.all([
      apiRequest('/api/settings'),
      apiRequest('/api/expenses'),
      apiRequest('/api/categories'),
      apiRequest('/api/recurring')
    ]);

    displayName = settings.displayName || displayName;
    monthlyBudget = Number(settings.monthlyBudget) || monthlyBudget;
    currency = supportedCurrencies.includes(settings.currency) ? settings.currency : 'USD';
    currencyFormatter = createCurrencyFormatter(currency);
    expenses = Array.isArray(loadedExpenses) ? loadedExpenses : [];
    categories = Array.isArray(loadedCategories) ? loadedCategories : [...defaultCategories];
    recurringSchedules = Array.isArray(loadedRecurring) ? loadedRecurring : [];
    document.getElementById('app-shell').hidden = false;
    document.getElementById('auth-screen').hidden = true;
    syncCategoryControls();
    renderManagedCategories();
    renderRecurringSchedules();
    updateSettingsInputs();
    handleNavigation();
    selectedExpenseId = expenses[0]?.id || null;
    scheduleRender();
  } catch (error) {
    console.error('Unable to load dashboard state:', error);
    showAuthScreen(error.message || 'Unable to load your account.');
  }
}

let currencyFormatter = createCurrencyFormatter(currency);

function createCurrencyFormatter(currencyCode) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currencyCode
  });
}

const navLinks = document.querySelectorAll('.sidebar nav a');
const pageSections = document.querySelectorAll('.page-section');
const expenseForm = document.getElementById('expense-form');
const expenseDialog = document.getElementById('expense-dialog');
const dialogOpenButton = document.getElementById('open-expense-dialog');
const dialogCloseButton = document.getElementById('close-expense-dialog');
const expenseDateInput = document.getElementById('expense-date');
const expenseDateTodayButton = document.getElementById('expense-date-today');
const expenseCategorySelect = document.getElementById('expense-category');
const expenseCategoryWrap = document.querySelector('.category-select-wrap');
const expenseCategoryTrigger = document.getElementById('expense-category-trigger');
const expenseCategoryValue = document.getElementById('expense-category-value');
const expenseCategoryOptions = document.getElementById('expense-category-options');
const expenseCategoryDescription = document.getElementById('expense-category-description');
const searchInput = document.getElementById('expense-search');
const searchContainer = document.getElementById('search-container');
const searchClearButton = document.getElementById('search-clear');
const searchResults = document.getElementById('search-results');
const categoryFilter = document.getElementById('category-filter');
const categoryFilterControl = document.getElementById('category-filter-control');
const categoryFilterTrigger = document.getElementById('category-filter-trigger');
const categoryFilterValue = document.getElementById('category-filter-value');
const categoryFilterOptions = document.getElementById('category-filter-options');
const notificationButton = document.getElementById('notification-button');
const notificationPanel = document.getElementById('notification-panel');
const notificationList = document.getElementById('notification-list');
const notificationMessage = document.getElementById('notification-message');
const toastRegion = document.getElementById('toast-region');
const expenseFormMessage = document.getElementById('expense-form-message');
const settingsForm = document.getElementById('settings-form');
const sidebarUserName = document.getElementById('sidebar-user-name');
const timelineAddExpenseButton = document.getElementById('timeline-add-expense');

const notificationHistory = [];

async function apiRequest(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error('Unable to connect to SpendWise. In the project terminal, run `npm start`, then retry.');
  }

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status}).`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function setFormMessage(element, type, message) {
  if (!element) return;
  const safeType = ['success', 'warning', 'error', 'info'].includes(type) ? type : 'info';
  element.className = `form-message form-message--${safeType}`;
  element.hidden = true;
  element.textContent = message || '';
  element.setAttribute('role', safeType === 'error' ? 'alert' : 'status');
}

function showToast(type, title, message) {
  const iconByType = { success: '✓', warning: '!', error: '×', info: 'i' };
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');

  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = iconByType[type];

  const copy = document.createElement('span');
  copy.className = 'toast-copy';
  const heading = document.createElement('strong');
  heading.textContent = title;
  const detail = document.createElement('span');
  detail.textContent = message;
  copy.append(heading, detail);

  const dismiss = document.createElement('button');
  dismiss.className = 'toast-dismiss';
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss notification');
  dismiss.textContent = '×';
  dismiss.addEventListener('click', () => toast.remove());

  toast.append(icon, copy, dismiss);
  toastRegion.replaceChildren(toast);
  window.clearTimeout(activeToastTimeout);
  activeToastTimeout = window.setTimeout(() => toast.remove(), type === 'error' ? 7000 : 5000);
}

function notifyUser(type, title, message) {
  notificationHistory.push({ id: crypto.randomUUID(), type, title, message });
  if (notificationHistory.length > 4) notificationHistory.shift();
  showToast(type, title, message);

  if (notificationList) {
    notificationList.innerHTML = notificationHistory.map((item) => `
      <div class="notification-item notification-item--${item.type}">
        <span class="notification-icon" aria-hidden="true">${item.type === 'success' ? '✓' : item.type === 'warning' ? '!' : item.type === 'error' ? '×' : 'i'}</span>
        <div class="notification-copy">
          <strong>${escapeHTML(item.title)}</strong>
          <span>${escapeHTML(item.message)}</span>
        </div>
      </div>
    `).join('');
  }

  if (notificationMessage) {
    notificationMessage.textContent = message;
  }

  if (notificationButton) {
    notificationButton.classList.toggle('has-alert', notificationHistory.some((item) => item.type !== 'success' && item.type !== 'info'));
  }
}

function renderAfterIdle() {
  if (window.requestIdleCallback) {
    window.requestIdleCallback(() => scheduleRender());
    return;
  }
  setTimeout(() => scheduleRender(), 50);
}

function showAuthScreen(message = '') {
  document.getElementById('app-shell').hidden = true;
  document.getElementById('auth-screen').hidden = false;
  document.title = 'Sign in | SpendWise';
  setAuthMode('login');
  setFormMessage(document.getElementById('auth-message'), message ? 'info' : 'info', message || '');
  if (message && message !== 'Sign in or create an account to continue.') {
    const isConnectionError = message.includes('connect to SpendWise') || message.includes('Unable to');
    notifyUser(isConnectionError ? 'error' : 'info', isConnectionError ? 'Unable to load account' : 'Sign-in required', message);
  }
  document.getElementById('auth-retry').hidden = !message.includes('connect to SpendWise');
}

function setAuthMode(mode) {
  const isRegister = mode === 'register';
  document.getElementById('login-form').hidden = isRegister;
  document.getElementById('register-form').hidden = !isRegister;
  document.getElementById('mfa-setup-form').hidden = true;
  document.getElementById('mfa-verify-form').hidden = true;
  document.getElementById('recovery-codes-panel').hidden = true;
  document.getElementById('auth-resend-verification').hidden = true;
  document.getElementById('auth-back-to-login').hidden = true;
  document.getElementById('auth-mode-toggle').hidden = false;
  document.getElementById('auth-title').textContent = isRegister ? 'Create your account' : 'Welcome back';
  document.getElementById('auth-description').textContent = isRegister
    ? 'A private place for your everyday money decisions.'
    : 'Your spending, organized around what matters to you.';
  document.getElementById('auth-mode-toggle').textContent = isRegister ? 'Already have an account? Sign in' : 'Create an account';
  setFormMessage(document.getElementById('auth-message'), 'info', '');
  document.getElementById('auth-mode-toggle').dataset.mode = isRegister ? 'login' : 'register';
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function toISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatCurrency(amount) {
  return currencyFormatter.format(amount);
}

function formatLongDate(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatShortDate(value) {
  if (!value) return '—';
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function getCategoryLabel(name) {
  return categories.find((category) => category.name === name)?.label || name;
}

function getCategoryIcon(name) {
  const knownIcons = {
    Food: 'fa-utensils',
    Transport: 'fa-car',
    Housing: 'fa-house',
    Entertainment: 'fa-film',
    Savings: 'fa-piggy-bank',
    Utilities: 'fa-plug',
    Other: 'fa-shapes'
  };
  return knownIcons[name] || 'fa-tag';
}

function openCategoryExpenses(categoryName) {
  if (!categories.some((category) => category.name === categoryName)) return;
  searchInput.value = '';
  searchClearButton.hidden = true;
  searchResultsOpen = false;
  closeSearchResults();
  categoryFilter.value = categoryName;
  categoryFilter.dispatchEvent(new Event('change', { bubbles: true }));
  window.location.hash = 'expenses';
}

function getCategoryTotal(categoryName) {
  return expenses.reduce((total, expense) => total + (expense.category === categoryName ? expense.amount : 0), 0);
}

function getVisibleExpenses() {
  const query = (searchInput?.value || '').trim().toLowerCase();
  const filter = categoryFilter?.value || 'all';

  const filtered = expenses.filter((expense) => {
    const matchesCategory = filter === 'all' || expense.category === filter;
    const haystack = `${expense.name} ${expense.category} ${getCategoryLabel(expense.category)} ${expense.description || ''} ${expense.amount} ${expense.date}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    return matchesCategory && matchesQuery;
  });

  return [...filtered].sort((a, b) => new Date(b.date) - new Date(a.date));
}

function matchesSearch(values, query) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return !normalizedQuery || values.some((value) => String(value ?? '').toLocaleLowerCase().includes(normalizedQuery));
}

function getVisibleCategories() {
  const query = searchInput.value.trim();
  return categories.filter((category) => matchesSearch([
    category.name,
    category.label,
    category.description,
    getCategoryTotal(category.name)
  ], query));
}

function getVisibleRecurringSchedules() {
  const query = searchInput.value.trim();
  return recurringSchedules.filter((schedule) => matchesSearch([
    schedule.name,
    schedule.category,
    getCategoryLabel(schedule.category),
    schedule.description,
    schedule.amount,
    schedule.day,
    schedule.nextRunDate
  ], query));
}

function getSearchResults(query) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const matchingExpenses = expenses.filter((expense) => matchesSearch([
    expense.name,
    expense.category,
    getCategoryLabel(expense.category),
    expense.description,
    expense.amount,
    expense.date
  ], normalizedQuery)).slice(0, 4).map((expense) => ({
    type: 'expense',
    id: expense.id,
    title: expense.name,
    detail: `${getCategoryLabel(expense.category)} · ${formatCurrency(expense.amount)} · ${formatShortDate(expense.date)}`
  }));
  const matchingCategories = categories.filter((category) => matchesSearch([
    category.name,
    category.label,
    category.description,
    getCategoryTotal(category.name)
  ], normalizedQuery)).slice(0, 4).map((category) => ({
    type: 'category',
    id: category.name,
    title: category.label,
    detail: `${expenses.filter((expense) => expense.category === category.name).length} transactions · ${formatCurrency(getCategoryTotal(category.name))}`
  }));
  const matchingSchedules = recurringSchedules.filter((schedule) => matchesSearch([
    schedule.name,
    schedule.category,
    getCategoryLabel(schedule.category),
    schedule.description,
    schedule.amount,
    schedule.day,
    schedule.nextRunDate
  ], normalizedQuery)).slice(0, 4).map((schedule) => ({
    type: 'recurring',
    id: schedule.id,
    title: schedule.name,
    detail: `${formatCurrency(schedule.amount)} · ${getCategoryLabel(schedule.category)} · next ${formatLongDate(schedule.nextRunDate)}`
  }));

  return [
    ...matchingExpenses,
    ...matchingCategories,
    ...matchingSchedules
  ].slice(0, 12);
}

function closeSearchResults() {
  searchResultsOpen = false;
  searchResults.hidden = true;
  searchInput.setAttribute('aria-expanded', 'false');
}

function selectSearchResult(result) {
  searchInput.value = result.title;
  searchClearButton.hidden = false;

  if (result.type === 'expense') {
    selectedExpenseId = result.id;
    categoryFilter.value = 'all';
    updateCategoryFilterMenu();
    window.location.hash = 'expenses';
  } else if (result.type === 'category') {
    categoryFilter.value = result.id;
    updateCategoryFilterMenu();
    window.location.hash = 'categories';
  } else {
    categoryFilter.value = 'all';
    updateCategoryFilterMenu();
    window.location.hash = 'settings';
    document.getElementById('recurring-list').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  closeSearchResults();
  scheduleRender();
}

function renderSearchResults() {
  const query = searchInput.value.trim();
  searchClearButton.hidden = !query;
  searchResults.replaceChildren();

  if (!query) {
    closeSearchResults();
    return;
  }

  const results = getSearchResults(query);
  if (!results.length) {
    const emptyResult = document.createElement('p');
    emptyResult.className = 'search-empty';
    emptyResult.textContent = 'No matching expenses, categories, or recurring schedules.';
    searchResults.appendChild(emptyResult);
  } else {
    const groups = [
      { type: 'expense', label: 'Expenses', kind: 'Expense' },
      { type: 'category', label: 'Categories', kind: 'Category' },
      { type: 'recurring', label: 'Recurring', kind: 'Recurring' }
    ];

    groups.forEach(({ type, label }) => {
      const groupResults = results.filter((result) => result.type === type);
      if (!groupResults.length) return;

      const group = document.createElement('div');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', label);
      const heading = document.createElement('p');
      heading.className = 'search-group-label';
      heading.textContent = label;
      group.appendChild(heading);

      groupResults.forEach((result) => {
        const option = document.createElement('button');
        option.className = 'search-result';
        option.type = 'button';
        option.setAttribute('role', 'option');
        option.setAttribute('aria-selected', 'false');
        option.dataset.resultType = result.type;
        option.dataset.resultId = result.id;

        const copy = document.createElement('span');
        copy.className = 'search-result-copy';
        const title = document.createElement('strong');
        title.textContent = result.title;
        const detail = document.createElement('small');
        detail.textContent = result.detail;
        copy.append(title, detail);

        const kind = document.createElement('span');
        kind.className = 'search-result-kind';
        kind.textContent = type === 'recurring' ? 'Recurring' : type === 'category' ? 'Category' : 'Expense';
        option.append(copy, kind);
        option.addEventListener('click', () => selectSearchResult(result));
        group.appendChild(option);
      });
      searchResults.appendChild(group);
    });
  }

  searchResults.hidden = !searchResultsOpen;
  searchInput.setAttribute('aria-expanded', String(searchResultsOpen));
}

function renderSummaryTags() {
  const now = new Date();
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const currentMonth = toISO(new Date(now.getFullYear(), now.getMonth(), 1)).slice(0, 7);
  const monthExpenses = expenses.filter((expense) => expense.date.slice(0, 7) === currentMonth);
  const totalSpent = monthExpenses.reduce((total, expense) => total + expense.amount, 0);
  const allTimeTotal = expenses.reduce((total, expense) => total + expense.amount, 0);
  const remaining = monthlyBudget - totalSpent;
  const budgetUsed = monthlyBudget ? (totalSpent / monthlyBudget) * 100 : 0;

  document.getElementById('dashboard-date').textContent = now.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).toUpperCase();
  document.getElementById('current-month-label').textContent = now.toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric'
  });
  document.getElementById('chart-month-end').textContent = monthEnd.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  });

  document.getElementById('total-spent').textContent = formatCurrency(totalSpent);
  document.getElementById('monthly-budget').textContent = formatCurrency(monthlyBudget);
  document.getElementById('remaining-balance').textContent = formatCurrency(remaining);
  document.getElementById('budget-used').textContent = `${Math.min(Math.round(budgetUsed), 100)}%`;
  document.getElementById('budget-progress-bar').style.width = `${Math.min(budgetUsed, 100)}%`;
  document.getElementById('budget-daily').textContent = formatCurrency(Math.max(totalSpent / 30, 0));
  document.getElementById('activity-transactions').textContent = String(monthExpenses.length);
  document.getElementById('activity-average').textContent = formatCurrency(monthExpenses.length ? totalSpent / monthExpenses.length : 0);
  document.getElementById('activity-daily').textContent = formatCurrency(Math.max(totalSpent / 30, 0));

  document.getElementById('analytics-total').textContent = formatCurrency(allTimeTotal);
  document.getElementById('analytics-count').textContent = String(expenses.length);
  document.getElementById('analytics-average').textContent = formatCurrency(expenses.length ? allTimeTotal / expenses.length : 0);

  document.getElementById('sidebar-user-name').textContent = displayName;
  document.getElementById('sidebar-avatar').textContent = displayName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase() || 'U';
  document.getElementById('welcome-message').textContent = remaining < 0
    ? `You are ${formatCurrency(Math.abs(remaining))} over budget this month.`
    : `You have ${formatCurrency(remaining)} left in your budget this month.`;
  document.getElementById('dashboard-title').textContent = `Good morning, ${displayName}`;

  let budgetType = 'success';
  let budgetSummary = 'Everything looks on track this month.';
  if (remaining < 0) {
    budgetType = 'warning';
    budgetSummary = 'Budget alert: you are over your monthly target.';
  } else if (budgetUsed >= 80) {
    budgetType = 'warning';
    budgetSummary = 'You are approaching your monthly spending limit.';
  } else if (remaining <= monthlyBudget * 0.2) {
    budgetType = 'info';
    budgetSummary = 'You still have a little cushion left this month.';
  }

  if (notificationMessage) notificationMessage.textContent = budgetSummary;
  if (notificationButton) notificationButton.classList.toggle('has-alert', budgetType !== 'success');
  if (notificationPanel) notificationPanel.dataset.status = budgetType;

  const budgetNotice = remaining < 0 ? 'over' : budgetUsed >= 80 ? 'approaching' : 'safe';
  if (budgetNotice !== lastBudgetNotice) {
    if (budgetNotice === 'over' || budgetNotice === 'approaching') {
      notifyUser('warning', budgetNotice === 'over' ? 'Budget exceeded' : 'Budget getting low', budgetSummary);
    }
    lastBudgetNotice = budgetNotice;
  }
}

function renderTransactionList() {
  const visibleExpenses = getVisibleExpenses();
  const list = document.getElementById('recent-expenses-list');
  list.innerHTML = '';

  const items = visibleExpenses.slice(0, 5);

  if (!items.length) {
    list.innerHTML = '<div class="empty-state">No expenses match your filters.</div>';
    return;
  }

  items.forEach((expense) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'transaction-item';
    if (selectedExpenseId === expense.id) item.classList.add('selected');
    item.innerHTML = `
      <span class="transaction-dot ${escapeHTML(expense.category.toLowerCase())}"></span>
      <span class="transaction-copy">
        <strong>${escapeHTML(expense.name)}</strong>
        <small>${escapeHTML(getCategoryLabel(expense.category))} • ${formatShortDate(expense.date)}</small>
      </span>
      <span class="transaction-amount">${formatCurrency(expense.amount)}</span>
    `;
    item.addEventListener('click', () => {
      selectedExpenseId = expense.id;
      renderSelectedExpense();
      renderTransactionList();
    });
    list.appendChild(item);
  });
}

function renderSelectedExpense() {
  const details = document.getElementById('selected-expense-details');
  const visible = getVisibleExpenses();
  const selected = visible.find((expense) => expense.id === selectedExpenseId) || visible[0];

  if (!selected) {
    details.innerHTML = '<p class="empty-state">No expense selected.</p>';
    return;
  }

  selectedExpenseId = selected.id;
  details.innerHTML = `
    <div class="selected-expense-header">
      <span class="transaction-dot ${escapeHTML(selected.category.toLowerCase())}"></span>
      <div>
        <h3>${escapeHTML(selected.name)}</h3>
        <p>${escapeHTML(getCategoryLabel(selected.category))}</p>
      </div>
    </div>
    <dl class="detail-list">
      <div><dt>Amount</dt><dd>${formatCurrency(selected.amount)}</dd></div>
      <div><dt>Date</dt><dd>${formatLongDate(selected.date)}</dd></div>
      <div><dt>Description</dt><dd>${escapeHTML(selected.description || '—')}</dd></div>
    </dl>
    <div class="detail-actions">
      <button class="secondary-button" id="expense-edit-button" type="button">Edit</button>
      <button class="danger-button" id="expense-delete-button" type="button">Delete</button>
    </div>
  `;

  const editButton = document.getElementById('expense-edit-button');
  const deleteButton = document.getElementById('expense-delete-button');

  if (editButton) {
    editButton.addEventListener('click', () => {
      const targetExpense = expenses.find((expense) => expense.id === selectedExpenseId);
      openExpenseDialog(targetExpense || selected);
    });
  }

  if (deleteButton) {
    deleteButton.addEventListener('click', async () => {
      const targetExpense = expenses.find((expense) => expense.id === selectedExpenseId);
      if (!targetExpense) return;

      const confirmed = window.confirm(`Delete ${targetExpense.name}?`);
      if (!confirmed) return;

      try {
        await apiRequest(`/api/expenses/${encodeURIComponent(targetExpense.id)}`, { method: 'DELETE' });
        expenses = expenses.filter((expense) => expense.id !== targetExpense.id);
        const nextSelection = expenses.find((expense) => expense.id !== targetExpense.id) || expenses[0] || null;
        selectedExpenseId = nextSelection ? nextSelection.id : null;
        notifyUser('success', 'Expense deleted', `${targetExpense.name} was removed.`);
        scheduleRender();
      } catch (error) {
        setFormMessage(expenseFormMessage, 'error', error.message);
        notifyUser('error', 'Expense deletion failed', error.message);
      }
    });
  }
}

function renderExpenseTable() {
  const tableBody = document.getElementById('expense-table-body');
  const resultCount = document.getElementById('expense-result-count');
  const visible = getVisibleExpenses();
  tableBody.innerHTML = '';

  if (!visible.length) {
    tableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No expenses found.</td></tr>';
    resultCount.textContent = '0 records';
    return;
  }

  resultCount.textContent = `${visible.length} ${visible.length === 1 ? 'record' : 'records'}`;

  visible.forEach((expense) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHTML(expense.name)}</td>
      <td>${formatCurrency(expense.amount)}</td>
      <td>${escapeHTML(getCategoryLabel(expense.category))}</td>
      <td>${formatLongDate(expense.date)}</td>
      <td>${escapeHTML(expense.description || '—')}</td>
    `;
    row.addEventListener('click', () => {
      selectedExpenseId = expense.id;
      renderTransactionList();
      renderSelectedExpense();
    });
    tableBody.appendChild(row);
  });
}

function renderCategoryGrid() {
  const categoryGrid = document.getElementById('category-grid');
  categoryGrid.innerHTML = '';

  const visibleCategories = getVisibleCategories();
  if (!visibleCategories.length) {
    categoryGrid.innerHTML = '<p class="empty-state">No categories match your search.</p>';
    return;
  }

  visibleCategories.forEach((category) => {
    const total = getCategoryTotal(category.name);
    const count = expenses.filter((expense) => expense.category === category.name).length;
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'card category-card';
    card.dataset.category = category.name;
    card.setAttribute('aria-label', `View ${category.label} expenses`);
    card.innerHTML = `
      <span class="category-card-heading">
        <span class="category-icon" aria-hidden="true"><i class="fa-solid ${getCategoryIcon(category.name)}"></i></span>
        <strong class="category-card-title">${escapeHTML(category.label)}</strong>
      </span>
      <span class="muted-text category-card-description">${escapeHTML(category.description)}</span>
      <span class="amount">${formatCurrency(total)}</span>
      <span class="category-card-footer">
        <span class="category-card-count">${count} ${count === 1 ? 'transaction' : 'transactions'}</span>
        <span class="category-card-action">View expenses <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></span>
      </span>
    `;
    card.addEventListener('click', () => openCategoryExpenses(category.name));
    categoryGrid.appendChild(card);
  });
}

function renderDashboardCategorySnapshot() {
  const list = document.getElementById('dashboard-category-snapshot');
  list.innerHTML = '';

  getVisibleCategories().forEach((category) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'category-snapshot-item';
    item.setAttribute('aria-label', `View ${category.label} expenses`);
    item.innerHTML = `
      <span class="category-snapshot-label">
        <i class="fa-solid ${getCategoryIcon(category.name)}" aria-hidden="true"></i>
        <span>${escapeHTML(category.label)}</span>
      </span>
      <strong>${formatCurrency(getCategoryTotal(category.name))}</strong>
    `;
    item.addEventListener('click', () => openCategoryExpenses(category.name));
    list.appendChild(item);
  });
}

function renderAnalyticsBars() {
  const month = new Date().toISOString().slice(0, 7);
  const monthExpenses = expenses.filter((expense) => expense.date.slice(0, 7) === month);
  const total = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const list = document.getElementById('analytics-category-list');
  list.innerHTML = '';

  getVisibleCategories().forEach((category) => {
    const categoryTotal = monthExpenses.reduce((sum, expense) =>
      sum + (expense.category === category.name ? expense.amount : 0), 0);
    const percentage = total ? (categoryTotal / total) * 100 : 0;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'analytics-row analytics-category-button';
    row.setAttribute('aria-label', `View ${category.label} expenses for ${formatCurrency(categoryTotal)}, ${Math.round(percentage)} percent of monthly spending`);
    row.innerHTML = `
      <span class="analytics-row-heading">
        <span class="analytics-category-name"><i class="fa-solid ${getCategoryIcon(category.name)}" aria-hidden="true"></i>${escapeHTML(category.label)}</span>
        <span>${formatCurrency(categoryTotal)} · ${Math.round(percentage)}%</span>
      </span>
      <span class="progress-track"><span class="progress-bar" style="width:${Math.max(percentage, categoryTotal ? 8 : 0)}%"></span></span>
    `;
    row.addEventListener('click', () => openCategoryExpenses(category.name));
    list.appendChild(row);
  });
}

function renderMiniBars() {
  const container = document.getElementById('weekly-spending-bars');
  container.innerHTML = '';
  const weeklyTotals = [0, 0, 0, 0, 0];

  expenses.forEach((expense) => {
    const daysAgo = Math.floor((new Date() - new Date(`${expense.date}T12:00:00`)) / 86400000);
    if (daysAgo < 0 || daysAgo >= 35) return;

    const bucket = Math.floor(daysAgo / 7);
    weeklyTotals[4 - bucket] += expense.amount;
  });

  const max = Math.max(...weeklyTotals, 1);
  weeklyTotals.forEach((total) => {
    const bar = document.createElement('span');
    bar.className = 'mini-bar';
    bar.style.height = `${Math.max((total / max) * 100, 10)}%`;
    container.appendChild(bar);
  });
}

function renderChart() {
  const svg = document.getElementById('activity-chart');
  const area = document.getElementById('activity-area');
  const line = document.getElementById('activity-line');
  const point = document.getElementById('activity-point');
  const totalDays = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate();
  const values = Array.from({ length: totalDays }, (_, index) => {
    const date = new Date(new Date().getFullYear(), new Date().getMonth(), index + 1);
    const iso = toISO(date);
    return expenses.filter((expense) => expense.date === iso).reduce((sum, expense) => sum + expense.amount, 0);
  });

  const maxValue = Math.max(...values, 1);
  const width = 480;
  const height = 108;
  const padding = 10;

  const points = values.map((value, index) => {
    const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2);
    const y = height - padding - (value / maxValue) * (height - padding * 2);
    return `${x},${y}`;
  });

  const areaPath = `${points[0] ? `M ${points[0].split(',')[0]} ${height - padding} ` : ''}`;
  const firstPoint = points[0] ? points[0].split(',') : ['0', `${height - padding}`];

  const areaCoords = points.map((pointValue) => {
    const [x, y] = pointValue.split(',');
    return `${x} ${y}`;
  }).join(' L ');

  const fillPath = `M ${firstPoint[0]} ${height - padding} L ${areaCoords} L ${width - padding} ${height - padding} Z`;
  area.setAttribute('d', fillPath);
  line.setAttribute('points', points.join(' '));

  const lastPoint = points[points.length - 1]?.split(',') || ['0', '0'];
  point.setAttribute('cx', lastPoint[0]);
  point.setAttribute('cy', lastPoint[1]);
}

function renderCalendar() {
  const calendarContainer = document.getElementById('calendar-days');
  const monthLabel = document.getElementById('calendar-month');
  monthLabel.textContent = currentCalendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const firstDay = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth(), 1);
  const lastDay = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1, 0);
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((leadingDays + lastDay.getDate()) / 7) * 7;

  calendarContainer.innerHTML = '';

  for (let index = 0; index < totalCells; index += 1) {
    const dayNumber = index - leadingDays + 1;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'calendar-day';

    if (dayNumber <= 0 || dayNumber > lastDay.getDate()) {
      button.disabled = true;
      button.classList.add('is-muted');
      button.textContent = '';
      calendarContainer.appendChild(button);
      continue;
    }

    const dateValue = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth(), dayNumber);
    const iso = toISO(dateValue);
    const hasExpense = expenses.some((expense) => expense.date === iso);
    const isSelected = iso === selectedDate;

    button.textContent = dayNumber;
    button.classList.toggle('is-selected', isSelected);
    if (hasExpense) button.classList.add('has-expense');
    if (iso === toISO(new Date())) button.classList.add('is-today');

    button.addEventListener('click', () => {
      selectedDate = iso;
      renderCalendar();
      renderTimeline();
    });

    calendarContainer.appendChild(button);
  }
}

function renderTimeline() {
  const list = document.getElementById('daily-expenses-list');
  const selectedTitle = document.getElementById('selected-date-title');
  const today = toISO(new Date());
  const filtered = getVisibleExpenses().filter((expense) => expense.date === selectedDate);

  selectedTitle.textContent = selectedDate === today ? 'Today' : new Date(`${selectedDate}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  list.innerHTML = '';

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No expenses recorded on this date.</div>';
    return;
  }

  filtered.forEach((expense) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'timeline-item';
    item.innerHTML = `
      <span class="timeline-pin ${escapeHTML(expense.category.toLowerCase())}"></span>
      <span class="timeline-copy">
        <strong>${escapeHTML(expense.name)}</strong>
        <small>${escapeHTML(getCategoryLabel(expense.category))}</small>
      </span>
      <span class="timeline-time">${formatShortDate(expense.date)}</span>
    `;
    item.addEventListener('click', () => {
      selectedExpenseId = expense.id;
      renderSelectedExpense();
      renderTransactionList();
    });
    list.appendChild(item);
  });
}

function updateSettingsInputs() {
  document.getElementById('user-name').value = displayName;
  document.getElementById('budget-amount').value = monthlyBudget;
  document.getElementById('default-currency').value = currency;
  updateCurrencyLabels();
}

function updateCurrencyLabels() {
  document.querySelectorAll('[data-currency-code]').forEach((label) => {
    label.textContent = document.getElementById('default-currency').value || currency;
  });
}

function updateExpenseCategoryDescription() {
  const selectedCategory = categories.find((category) => category.name === expenseCategorySelect.value);
  expenseCategoryValue.textContent = selectedCategory?.label || 'Choose a category';
  expenseCategoryDescription.textContent = selectedCategory?.description || 'Choose a category for this expense.';
  Array.from(expenseCategoryOptions.children).forEach((optionButton) => {
    const isSelected = optionButton.dataset.value === expenseCategorySelect.value;
    optionButton.setAttribute('aria-selected', String(isSelected));
    optionButton.classList.toggle('is-selected', isSelected);
  });
}

function closeExpenseCategoryMenu(returnFocus = false) {
  expenseCategoryOptions.hidden = true;
  expenseCategoryTrigger.setAttribute('aria-expanded', 'false');
  expenseCategoryOptions.style.removeProperty('top');
  expenseCategoryOptions.style.removeProperty('bottom');
  expenseCategoryOptions.style.removeProperty('left');
  expenseCategoryOptions.style.removeProperty('width');
  expenseCategoryOptions.style.removeProperty('max-height');
  if (returnFocus) expenseCategoryTrigger.focus();
}

function positionExpenseCategoryMenu() {
  const triggerRect = expenseCategoryTrigger.getBoundingClientRect();
  const edgePadding = 12;
  const gap = 8;
  const menuWidth = Math.min(triggerRect.width, window.innerWidth - edgePadding * 2);
  const left = Math.max(edgePadding, Math.min(triggerRect.left, window.innerWidth - menuWidth - edgePadding));
  const availableBelow = Math.max(0, window.innerHeight - triggerRect.bottom - gap - edgePadding);
  const availableAbove = Math.max(0, triggerRect.top - gap - edgePadding);
  const desiredHeight = Math.min(300, expenseCategoryOptions.scrollHeight);
  const openBelow = availableBelow >= desiredHeight || availableBelow >= availableAbove;
  const availableHeight = Math.min(desiredHeight, openBelow ? availableBelow : availableAbove);
  const top = openBelow
    ? triggerRect.bottom + gap
    : triggerRect.top - gap - availableHeight;

  expenseCategoryOptions.style.left = `${left}px`;
  expenseCategoryOptions.style.width = `${menuWidth}px`;
  expenseCategoryOptions.style.maxHeight = `${availableHeight}px`;
  expenseCategoryOptions.style.top = `${top}px`;
  expenseCategoryOptions.style.bottom = 'auto';

  const menuRect = expenseCategoryOptions.getBoundingClientRect();
  expenseCategoryOptions.style.left = `${left + left - menuRect.left}px`;
  expenseCategoryOptions.style.top = `${top + top - menuRect.top}px`;
}

function openExpenseCategoryMenu(focusSelected = false) {
  expenseCategoryOptions.hidden = false;
  positionExpenseCategoryMenu();
  expenseCategoryTrigger.setAttribute('aria-expanded', 'true');

  if (focusSelected) {
    expenseCategoryOptions.querySelector('[aria-selected="true"]')?.focus();
  }
}

function selectExpenseCategory(optionButton) {
  expenseCategorySelect.value = optionButton.dataset.value;
  expenseCategorySelect.dispatchEvent(new Event('change', { bubbles: true }));
  closeExpenseCategoryMenu(true);
}

function syncCategoryControls() {
  const selectors = [
    { element: categoryFilter, includeAll: true },
    { element: expenseCategorySelect, includeAll: false },
    { element: document.getElementById('recurring-category'), includeAll: false }
  ];

  selectors.forEach(({ element, includeAll }) => {
    const previousValue = element.value;
    element.replaceChildren();
    if (includeAll) {
      const allOption = document.createElement('option');
      allOption.value = 'all';
      allOption.textContent = 'All categories';
      element.appendChild(allOption);
    }
    categories.forEach((category) => {
      const option = document.createElement('option');
      option.value = category.name;
      option.textContent = category.label;
      element.appendChild(option);
    });
    element.value = categories.some((category) => category.name === previousValue)
      ? previousValue
      : (includeAll ? 'all' : 'Food');
  });

  expenseCategoryOptions.replaceChildren();
  categories.forEach((category) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'category-select-option';
    optionButton.setAttribute('role', 'option');
    optionButton.dataset.value = category.name;
    optionButton.setAttribute('aria-selected', 'false');

    const icon = document.createElement('span');
    icon.className = 'category-select-option-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = `<i class="fa-solid ${getCategoryIcon(category.name)}"></i>`;
    const copy = document.createElement('span');
    copy.className = 'category-select-option-copy';
    const label = document.createElement('strong');
    label.textContent = category.label;
    const description = document.createElement('small');
    description.textContent = category.description;
    copy.append(label, description);
    optionButton.append(icon, copy);
    optionButton.addEventListener('click', () => selectExpenseCategory(optionButton));
    expenseCategoryOptions.appendChild(optionButton);
  });

  updateExpenseCategoryDescription();
  categoryFilterOptions.replaceChildren();
  Array.from(categoryFilter.options).forEach((option) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'category-filter-option';
    optionButton.setAttribute('role', 'option');
    optionButton.dataset.value = option.value;
    const icon = document.createElement('i');
    icon.className = `fa-solid category-filter-option-icon ${option.value === 'all' ? 'fa-layer-group' : getCategoryIcon(option.value)}`;
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = option.textContent;
    optionButton.append(icon, label);
    optionButton.addEventListener('click', () => selectCategoryFilterOption(optionButton));
    categoryFilterOptions.appendChild(optionButton);
  });
  updateCategoryFilterMenu();
}

function renderManagedCategories() {
  const list = document.getElementById('managed-category-list');
  const customCategories = categories.filter((category) => !category.builtIn && matchesSearch([
    category.name,
    category.label,
    category.description,
    getCategoryTotal(category.name)
  ], searchInput.value));
  list.replaceChildren();

  if (!customCategories.length) {
    list.innerHTML = `<p class="empty-state">${categories.some((category) => !category.builtIn) ? 'No custom categories match your search.' : 'No custom categories yet.'}</p>`;
    return;
  }

  customCategories.forEach((category) => {
    const inUse = expenses.some((expense) => expense.category === category.name) ||
      recurringSchedules.some((schedule) => schedule.category === category.name);
    const item = document.createElement('div');
    item.className = 'managed-list-item';
    item.innerHTML = `<span>${escapeHTML(category.label)}</span><button class="secondary-button" type="button" ${inUse ? 'disabled' : ''}>${inUse ? 'In use' : 'Remove'}</button>`;
    const button = item.querySelector('button');
    button.addEventListener('click', async () => {
      try {
        await apiRequest(`/api/categories/${encodeURIComponent(category.name)}`, { method: 'DELETE' });
        categories = categories.filter((itemCategory) => itemCategory.name !== category.name);
        setFormMessage(document.getElementById('category-message'), 'success', `${category.label} removed.`);
        notifyUser('success', 'Category removed', `${category.label} has been deleted.`);
        syncCategoryControls();
        renderManagedCategories();
        scheduleRender();
      } catch (error) {
        setFormMessage(document.getElementById('category-message'), 'error', error.message);
        notifyUser('error', 'Category removal failed', error.message);
      }
    });
    list.appendChild(item);
  });
}

function renderRecurringSchedules() {
  const list = document.getElementById('recurring-list');
  list.replaceChildren();

  const visibleSchedules = getVisibleRecurringSchedules();
  if (!visibleSchedules.length) {
    list.innerHTML = `<p class="empty-state">${recurringSchedules.length ? 'No recurring schedules match your search.' : 'No recurring expenses set up.'}</p>`;
    return;
  }

  visibleSchedules.forEach((schedule) => {
    const item = document.createElement('div');
    item.className = 'managed-list-item';
    item.innerHTML = `
      <span><strong>${escapeHTML(schedule.name)}</strong><small>${formatCurrency(schedule.amount)} · ${escapeHTML(getCategoryLabel(schedule.category))} · next ${formatLongDate(schedule.nextRunDate)}</small></span>
      <button class="secondary-button" type="button" aria-label="Remove ${escapeHTML(schedule.name)} recurring schedule">Remove</button>
    `;
    item.querySelector('button').addEventListener('click', async () => {
      try {
        await apiRequest(`/api/recurring/${encodeURIComponent(schedule.id)}`, { method: 'DELETE' });
        recurringSchedules = recurringSchedules.filter((entry) => entry.id !== schedule.id);
        setFormMessage(document.getElementById('recurring-message'), 'success', `${schedule.name} removed.`);
        notifyUser('success', 'Recurring expense removed', `${schedule.name} will no longer repeat.`);
        renderRecurringSchedules();
        renderManagedCategories();
      } catch (error) {
        setFormMessage(document.getElementById('recurring-message'), 'error', error.message);
        notifyUser('error', 'Recurring removal failed', error.message);
      }
    });
    list.appendChild(item);
  });
}

function renderAll() {
  renderSearchResults();
  renderSummaryTags();
  renderTransactionList();
  renderSelectedExpense();
  renderExpenseTable();
  renderCategoryGrid();
  renderDashboardCategorySnapshot();
  renderAnalyticsBars();
  renderMiniBars();
  renderChart();
  renderCalendar();
  renderTimeline();
  renderManagedCategories();
  renderRecurringSchedules();
}

function updateCategoryFilterMenu() {
  categoryFilterValue.textContent = categoryFilter.selectedOptions[0]?.textContent || 'All categories';

  Array.from(categoryFilterOptions.children).forEach((optionButton) => {
    const isSelected = optionButton.dataset.value === categoryFilter.value;
    optionButton.setAttribute('aria-selected', String(isSelected));
    optionButton.classList.toggle('is-selected', isSelected);
  });
}

function closeCategoryFilterMenu(returnFocus = false) {
  categoryFilterOptions.hidden = true;
  categoryFilterTrigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) categoryFilterTrigger.focus();
}

function openCategoryFilterMenu(focusSelected = false) {
  categoryFilterOptions.hidden = false;
  categoryFilterTrigger.setAttribute('aria-expanded', 'true');

  if (focusSelected) {
    const selectedOption = categoryFilterOptions.querySelector('[aria-selected="true"]');
    selectedOption?.focus();
  }
}

function selectCategoryFilterOption(optionButton) {
  categoryFilter.value = optionButton.dataset.value;
  categoryFilter.dispatchEvent(new Event('change', { bubbles: true }));
  closeCategoryFilterMenu(true);
}

syncCategoryControls();

categoryFilterTrigger.addEventListener('click', () => {
  if (categoryFilterOptions.hidden) {
    openCategoryFilterMenu();
  } else {
    closeCategoryFilterMenu();
  }
});

categoryFilterTrigger.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openCategoryFilterMenu(true);
  }
});

categoryFilterOptions.addEventListener('keydown', (event) => {
  const optionButtons = Array.from(categoryFilterOptions.querySelectorAll('[role="option"]'));
  const focusedIndex = optionButtons.indexOf(document.activeElement);
  let nextIndex = focusedIndex;

  if (event.key === 'ArrowDown') nextIndex = (focusedIndex + 1) % optionButtons.length;
  else if (event.key === 'ArrowUp') nextIndex = (focusedIndex - 1 + optionButtons.length) % optionButtons.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = optionButtons.length - 1;
  else if (event.key === 'Escape') {
    event.preventDefault();
    closeCategoryFilterMenu(true);
    return;
  } else if (event.key === 'Tab') {
    closeCategoryFilterMenu();
    return;
  } else {
    return;
  }

  event.preventDefault();
  optionButtons[nextIndex]?.focus();
});

document.addEventListener('pointerdown', (event) => {
  if (!categoryFilterControl.contains(event.target)) {
    closeCategoryFilterMenu();
  }
});

function showPage(pageId) {
  const targetId = document.getElementById(pageId) ? pageId : 'dashboard';
  if (expenseDialog && targetId === 'settings') {
    expenseDialog.close();
  }

  pageSections.forEach((section) => {
    section.hidden = section.id !== targetId;
  });

  navLinks.forEach((link) => {
    const isActive = link.getAttribute('href') === `#${targetId}`;
    link.classList.toggle('active', isActive);
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  document.title = `${document.getElementById(targetId).querySelector('h1').textContent} | SpendWise`;
}

function handleNavigation() {
  const pageId = window.location.hash.slice(1) || 'dashboard';
  showPage(pageId);
}

function resetExpenseDialogForm() {
  if (!expenseForm) return;

  expenseForm.reset();
  document.getElementById('expense-date').value = selectedDate;
  expenseCategorySelect.value = categories.some((category) => category.name === 'Food')
    ? 'Food'
    : categories[0]?.name || '';
  updateExpenseCategoryDescription();
  document.getElementById('expense-name').focus();
}

function openExpenseDialog(expense = null) {
  if (!expenseDialog) return;

  const title = document.getElementById('add-expense-title');
  editingExpenseId = expense ? expense.id : null;
  expenseForm.dataset.mode = editingExpenseId ? 'edit' : 'create';
  title.textContent = editingExpenseId ? 'Edit expense' : 'Add new expense';
  setFormMessage(expenseFormMessage, 'info', '');

  if (expense) {
    document.getElementById('expense-name').value = expense.name || '';
    document.getElementById('expense-amount').value = expense.amount || '';
    document.getElementById('expense-date').value = expense.date || selectedDate;
    document.getElementById('expense-description').value = expense.description || '';
    expenseCategorySelect.value = categories.some((category) => category.name === expense.category)
      ? expense.category
      : categories[0]?.name || '';
    updateExpenseCategoryDescription();
  } else {
    resetExpenseDialogForm();
  }

  expenseDialog.showModal();
}

function closeExpenseDialog() {
  if (!expenseDialog) return;
  expenseDialog.close();
  editingExpenseId = null;
  expenseForm.dataset.mode = 'create';
  document.getElementById('add-expense-title').textContent = 'Add new expense';
  expenseForm.reset();
  document.getElementById('expense-date').value = selectedDate;
  expenseCategorySelect.value = categories.some((category) => category.name === 'Food')
    ? 'Food'
    : categories[0]?.name || '';
  updateExpenseCategoryDescription();
}

expenseDateTodayButton.addEventListener('click', () => {
  expenseDateInput.value = toISO(new Date());
  expenseDateInput.dispatchEvent(new Event('input', { bubbles: true }));
  expenseDateInput.dispatchEvent(new Event('change', { bubbles: true }));
  expenseDateInput.focus();
});

expenseCategorySelect.addEventListener('change', updateExpenseCategoryDescription);
expenseCategoryTrigger.addEventListener('click', () => {
  if (expenseCategoryOptions.hidden) {
    openExpenseCategoryMenu();
  } else {
    closeExpenseCategoryMenu();
  }
});
expenseCategoryTrigger.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openExpenseCategoryMenu(true);
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    openExpenseCategoryMenu(true);
  } else if (event.key === 'Escape') {
    closeExpenseCategoryMenu();
  }
});
expenseCategoryOptions.addEventListener('keydown', (event) => {
  const optionButtons = Array.from(expenseCategoryOptions.querySelectorAll('[role="option"]'));
  const focusedIndex = optionButtons.indexOf(document.activeElement);
  let nextIndex = focusedIndex;

  if (event.key === 'ArrowDown') nextIndex = (focusedIndex + 1) % optionButtons.length;
  else if (event.key === 'ArrowUp') nextIndex = (focusedIndex - 1 + optionButtons.length) % optionButtons.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = optionButtons.length - 1;
  else if (event.key === 'Escape') {
    event.preventDefault();
    closeExpenseCategoryMenu(true);
    return;
  } else if (event.key === 'Tab') {
    closeExpenseCategoryMenu();
    return;
  } else {
    return;
  }

  event.preventDefault();
  optionButtons[nextIndex]?.focus();
});
document.addEventListener('pointerdown', (event) => {
  if (!expenseCategoryWrap.contains(event.target)) closeExpenseCategoryMenu();
});
window.addEventListener('resize', () => {
  if (!expenseCategoryOptions.hidden) positionExpenseCategoryMenu();
});
window.addEventListener('scroll', () => {
  if (!expenseCategoryOptions.hidden) positionExpenseCategoryMenu();
}, true);

expenseForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = document.getElementById('expense-name').value.trim();
  const amount = Number(document.getElementById('expense-amount').value);
  const date = document.getElementById('expense-date').value;
  const description = document.getElementById('expense-description').value.trim();
  const category = document.getElementById('expense-category').value;
  const isEditing = expenseForm.dataset.mode === 'edit' && editingExpenseId !== null;

  if (!name || !Number.isFinite(amount) || amount <= 0 || !date) {
    setFormMessage(expenseFormMessage, 'error', 'Please complete the form with a valid name, amount, and date.');
    notifyUser('error', 'Check expense details', 'Please enter a valid name, amount, and date.');
    return;
  }

  try {
    const endpoint = isEditing ? `/api/expenses/${encodeURIComponent(editingExpenseId)}` : '/api/expenses';
    const savedExpense = await apiRequest(endpoint, {
      method: isEditing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, amount, category, date, description })
    });

    if (isEditing) {
      const index = expenses.findIndex((expense) => expense.id === editingExpenseId);
      if (index !== -1) {
        expenses[index] = savedExpense;
      }
      setFormMessage(expenseFormMessage, 'success', 'Expense updated.');
      notifyUser('success', 'Expense updated', `${name} was updated successfully.`);
    } else {
      expenses.push(savedExpense);
      setFormMessage(expenseFormMessage, 'success', 'Expense added.');
      notifyUser('success', 'Expense added', `${name} was recorded to your spending log.`);
    }

    selectedDate = date;
    selectedExpenseId = savedExpense.id;
    scheduleRender();
    closeExpenseDialog();
  } catch (error) {
    setFormMessage(expenseFormMessage, 'error', error.message);
    notifyUser('error', 'Expense request failed', error.message);
  }
});

document.getElementById('default-currency').addEventListener('change', updateCurrencyLabels);

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const nextName = document.getElementById('user-name').value.trim();
  const nextBudget = Number(document.getElementById('budget-amount').value);
  const nextCurrency = document.getElementById('default-currency').value;
  const message = document.getElementById('settings-message');

  if (!nextName || !Number.isFinite(nextBudget) || nextBudget <= 0) {
    setFormMessage(message, 'error', 'Enter a display name and a positive monthly budget.');
    notifyUser('error', 'Check settings', 'Enter a display name and a positive monthly budget.');
    return;
  }

  try {
    const settings = await apiRequest('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: nextName, monthlyBudget: nextBudget, currency: nextCurrency })
    });

    displayName = settings.displayName;
    monthlyBudget = settings.monthlyBudget;
    currency = settings.currency;
    currencyFormatter = createCurrencyFormatter(currency);
    updateCurrencyLabels();
    setFormMessage(message, 'success', 'Settings saved.');
    notifyUser('success', 'Settings updated', `Your preferences and ${currency} currency were saved.`);
    scheduleRender();
  } catch (error) {
    setFormMessage(message, 'error', error.message);
    notifyUser('error', 'Settings update failed', error.message);
  }
});

const authModeToggle = document.getElementById('auth-mode-toggle');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

authModeToggle.addEventListener('click', () => setAuthMode(authModeToggle.dataset.mode || 'register'));

document.getElementById('auth-retry').addEventListener('click', () => {
  document.getElementById('auth-retry').hidden = true;
  loadDashboardState();
});

async function submitAuthForm(form, mode) {
  const message = document.getElementById('auth-message');
  const payload = mode === 'register'
    ? {
      displayName: document.getElementById('register-name').value.trim(),
      email: document.getElementById('register-email').value.trim(),
      password: document.getElementById('register-password').value
    }
    : {
      email: document.getElementById('login-email').value.trim(),
      password: document.getElementById('login-password').value
    };

  try {
    const result = await apiRequest(`/api/auth/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    form.reset();
    if (mode === 'register') {
      if (result.authenticated) {
        await loadDashboardState();
        return;
      }
      setAuthMode('login');
      document.getElementById('login-email').value = payload.email;
      document.getElementById('auth-resend-verification').hidden = false;
      setFormMessage(message, 'info', result.message);
      notifyUser(
        'info',
        result.verificationDelivery === 'local' ? 'Check the server terminal' : 'Check your email',
        result.message
      );
      return;
    }

    if (result.mfaRequired) {
      document.getElementById('login-form').hidden = true;
      document.getElementById('register-form').hidden = true;
      document.getElementById('auth-mode-toggle').hidden = true;
      document.getElementById('auth-resend-verification').hidden = true;
      document.getElementById('auth-back-to-login').hidden = false;
      document.getElementById('auth-title').textContent = result.setupRequired
        ? 'Set up your authenticator'
        : 'Verify it’s you';
      document.getElementById('auth-description').textContent = result.setupRequired
        ? 'One quick security step keeps your account protected.'
        : 'Enter a code from your authenticator app to continue.';

      if (result.setupRequired) {
        const setup = await apiRequest('/api/auth/mfa/setup');
        document.getElementById('mfa-secret').textContent = setup.secret;
        document.getElementById('mfa-setup-form').hidden = false;
        document.getElementById('mfa-setup-code').focus();
      } else {
        document.getElementById('mfa-verify-form').hidden = false;
        document.getElementById('mfa-login-code').focus();
      }
      return;
    }

    await loadDashboardState();
  } catch (error) {
    setFormMessage(message, 'error', error.message);
    notifyUser('error', 'Authentication failed', error.message);
    if (mode === 'login' && error.message.includes('Verify your email')) {
      document.getElementById('auth-resend-verification').hidden = false;
    }
  }
}

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuthForm(loginForm, 'login');
});

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuthForm(registerForm, 'register');
});

document.getElementById('auth-back-to-login').addEventListener('click', async () => {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    showAuthScreen();
  } catch (error) {
    notifyUser('error', 'Could not restart sign-in', error.message);
  }
});

document.getElementById('auth-resend-verification').addEventListener('click', async () => {
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    notifyUser('warning', 'Email needed', 'Enter the email address used for your account first.');
    document.getElementById('login-email').focus();
    return;
  }
  try {
    const result = await apiRequest('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    notifyUser(
      'info',
      result.verificationDelivery === 'local' ? 'Check the server terminal' : 'Check your email',
      result.message
    );
  } catch (error) {
    notifyUser('error', 'Email could not be sent', error.message);
  }
});

document.getElementById('mfa-setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const result = await apiRequest('/api/auth/mfa/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: document.getElementById('mfa-setup-code').value.trim() })
    });
    document.getElementById('mfa-setup-form').hidden = true;
    document.getElementById('auth-title').textContent = 'Save your recovery codes';
    document.getElementById('auth-description').textContent = 'Store these somewhere private before continuing.';
    document.getElementById('recovery-codes').textContent = result.recoveryCodes.join('\n');
    document.getElementById('recovery-codes-panel').hidden = false;
    document.getElementById('auth-back-to-login').hidden = true;
    document.getElementById('continue-after-recovery').focus();
    notifyUser('success', 'Authenticator verified', 'Your account now requires multi-factor authentication.');
  } catch (error) {
    notifyUser('error', 'Authenticator setup failed', error.message);
  }
});

document.getElementById('mfa-verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await apiRequest('/api/auth/mfa/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: document.getElementById('mfa-login-code').value.trim() })
    });
    await loadDashboardState();
  } catch (error) {
    notifyUser('error', 'Verification failed', error.message);
  }
});

document.getElementById('copy-mfa-secret').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(document.getElementById('mfa-secret').textContent);
    notifyUser('success', 'Setup key copied', 'Paste it into your authenticator app.');
  } catch (error) {
    notifyUser('error', 'Could not copy setup key', 'Select and copy the setup key manually.');
  }
});

document.getElementById('continue-after-recovery').addEventListener('click', loadDashboardState);

async function signOutAccount() {
  try {
    await apiRequest('/api/auth/logout', { method: 'POST' });
    account = null;
    expenses = [];
    recurringSchedules = [];
    showAuthScreen('You have been signed out.');
  } catch (error) {
    setFormMessage(document.getElementById('settings-message'), 'error', error.message);
    notifyUser('error', 'Sign-out failed', error.message);
  }
}

document.getElementById('logout-button').addEventListener('click', signOutAccount);
document.getElementById('sidebar-signout').addEventListener('click', signOutAccount);

document.getElementById('category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.getElementById('new-category-name');
  const message = document.getElementById('category-message');
  try {
    const category = await apiRequest('/api/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: input.value.trim() })
    });
    categories.push(category);
    input.value = '';
    setFormMessage(message, 'success', 'Category added.');
    notifyUser('success', 'Category created', `${category.label} is now available for your expenses.`);
    syncCategoryControls();
    renderManagedCategories();
    scheduleRender();
  } catch (error) {
    setFormMessage(message, 'error', error.message);
    notifyUser('error', 'Category creation failed', error.message);
  }
});

document.getElementById('recurring-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('recurring-message');
  const payload = {
    name: document.getElementById('recurring-name').value.trim(),
    amount: Number(document.getElementById('recurring-amount').value),
    category: document.getElementById('recurring-category').value,
    day: Number(document.getElementById('recurring-day').value),
    description: document.getElementById('recurring-description').value.trim()
  };
  try {
    const created = await apiRequest('/api/recurring', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    recurringSchedules = await apiRequest('/api/recurring');
    form.reset();
    document.getElementById('recurring-day').value = '1';
    setFormMessage(message, 'success', 'Monthly recurring expense added.');
    notifyUser('success', 'Recurring expense created', `${created.name} will repeat on ${created.day} of each month.`);
    renderRecurringSchedules();
    renderManagedCategories();
    scheduleRender();
  } catch (error) {
    setFormMessage(message, 'error', error.message);
    notifyUser('error', 'Recurring expense failed', error.message);
  }
});

searchInput.addEventListener('input', () => {
  searchResultsOpen = Boolean(searchInput.value.trim());
  renderSearchResults();
  scheduleRender();
});
searchInput.addEventListener('keydown', (event) => {
  const options = Array.from(searchResults.querySelectorAll('.search-result'));
  if (event.key === 'ArrowDown' && options.length) {
    event.preventDefault();
    options[0].focus();
  } else if (event.key === 'Enter' && options.length) {
    event.preventDefault();
    options[0].click();
  } else if (event.key === 'Escape') {
    closeSearchResults();
  }
});
searchResults.addEventListener('keydown', (event) => {
  const options = Array.from(searchResults.querySelectorAll('.search-result'));
  const focusedIndex = options.indexOf(document.activeElement);
  let nextIndex = focusedIndex;

  if (event.key === 'ArrowDown') nextIndex = (focusedIndex + 1) % options.length;
  else if (event.key === 'ArrowUp') nextIndex = (focusedIndex - 1 + options.length) % options.length;
  else if (event.key === 'Escape') {
    event.preventDefault();
    closeSearchResults();
    searchInput.focus();
    return;
  } else if (event.key === 'Tab') {
    closeSearchResults();
    return;
  } else {
    return;
  }

  event.preventDefault();
  options[nextIndex]?.focus();
});
searchClearButton.addEventListener('click', () => {
  searchInput.value = '';
  renderSearchResults();
  scheduleRender();
  searchInput.focus();
});
searchInput.addEventListener('focus', () => {
  if (searchInput.value.trim()) searchResultsOpen = true;
  renderSearchResults();
});
document.addEventListener('pointerdown', (event) => {
  if (!searchContainer.contains(event.target)) closeSearchResults();
});
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
    searchInput.select();
  }
});
categoryFilter.addEventListener('change', () => {
  updateCategoryFilterMenu();
  scheduleRender();
});
notificationButton.addEventListener('click', () => {
  const shouldShow = notificationPanel.hidden;
  notificationPanel.hidden = !shouldShow;
  notificationButton.setAttribute('aria-expanded', String(shouldShow));
});

dialogOpenButton.addEventListener('click', openExpenseDialog);
document.getElementById('sidebar-add-expense').addEventListener('click', openExpenseDialog);
document.getElementById('mobile-nav-add').addEventListener('click', openExpenseDialog);
dialogCloseButton.addEventListener('click', closeExpenseDialog);
timelineAddExpenseButton.addEventListener('click', () => {
  document.getElementById('expense-date').value = selectedDate;
  openExpenseDialog();
});

document.getElementById('calendar-prev').addEventListener('click', () => {
  currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() - 1, 1);
  renderCalendar();
});

document.getElementById('calendar-next').addEventListener('click', () => {
  currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + 1, 1);
  renderCalendar();
});

document.getElementById('calendar-today').addEventListener('click', () => {
  currentCalendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  selectedDate = toISO(new Date());
  renderCalendar();
  renderTimeline();
});

window.addEventListener('hashchange', handleNavigation);
updateSettingsInputs();
handleNavigation();
async function startSpendWise() {
  const verificationToken = new URLSearchParams(window.location.search).get('verify');
  if (!verificationToken) {
    await loadDashboardState();
    return;
  }

  window.history.replaceState({}, document.title, window.location.pathname);
  showAuthScreen();
  try {
    const result = await apiRequest('/api/auth/verify-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: verificationToken })
    });
    notifyUser('success', 'Email verified', result.message);
  } catch (error) {
    notifyUser('error', 'Email verification failed', error.message);
    document.getElementById('auth-resend-verification').hidden = false;
  }
}

startSpendWise();
