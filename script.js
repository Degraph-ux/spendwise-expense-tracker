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
let expenseTablePage = 1;
let appliedExpenseTableCategory = 'all';
let appliedExpenseTablePeriod = 'all';
let incomes = [];
let recurringSchedules = [];
let recurringIncomeSchedules = [];
let budgetRules = [];
let savingsGoals = [];
let financialReminders = [];
let account = null;
let realtimeSource = null;
let realtimeRefreshTimer = null;
let renderQueued = false;
let lastBudgetNotice = null;
let activeToastTimer = null;
let searchResultsOpen = false;
const budgetRuleNoticeIds = new Set();

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderAll();
  });
}

async function loadDashboardState() {
  const loading = document.getElementById('app-loading');
  loading.hidden = false;
  loading.setAttribute('aria-busy', 'true');
  document.getElementById('auth-screen').hidden = true;
  try {
    let accountResponse;
    try {
      accountResponse = await fetch('/api/auth/me');
    } catch (error) {
      throw new Error('Unable to connect to SpendWise. In the project terminal, run `npm start`, then retry.');
    }
    if (accountResponse.status === 401) {
      loading.hidden = true;
      loading.removeAttribute('aria-busy');
      showAuthScreen('Sign in or create an account to continue.');
      return;
    }
    if (!accountResponse.ok) throw new Error('Unable to verify your account.');
    const accountPayload = await accountResponse.json();
    if (!accountPayload.user?.id || !accountPayload.user?.email) {
      throw new Error('The server returned invalid account details. Please try again.');
    }
    account = accountPayload.user;
    document.querySelector('.account-avatar').hidden = accountPayload.avatarEnabled !== true;
    document.getElementById('account-email').textContent = account.email;
    document.getElementById('sidebar-account-email').textContent = account.email;

    const [
      settings,
      loadedExpenses,
      loadedCategories,
      loadedRecurring,
      loadedIncome,
      loadedRecurringIncome,
      loadedBudgets,
      loadedGoals,
      loadedReminders
    ] = await Promise.all([
      apiRequest('/api/settings'),
      apiRequest('/api/expenses'),
      apiRequest('/api/categories'),
      apiRequest('/api/recurring'),
      apiRequest('/api/income'),
      apiRequest('/api/recurring-income'),
      apiRequest('/api/budgets'),
      apiRequest('/api/goals'),
      apiRequest('/api/reminders')
    ]);

    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
      throw new Error('The server returned invalid account settings. Please try again.');
    }
    if (![loadedExpenses, loadedCategories, loadedRecurring, loadedIncome, loadedRecurringIncome,
      loadedBudgets, loadedGoals, loadedReminders].every(Array.isArray)) {
      throw new Error('The server returned incomplete account data. Your records were not replaced.');
    }
    const loadedBudget = Number(settings.monthlyBudget);
    if (!String(settings.displayName || '').trim() || !Number.isFinite(loadedBudget) || loadedBudget <= 0 ||
        !supportedCurrencies.includes(settings.currency)) {
      throw new Error('The server returned invalid account settings. Please check your settings and try again.');
    }

    displayName = settings.displayName;
    monthlyBudget = loadedBudget;
    currency = settings.currency;
    currencyFormatter = createCurrencyFormatter(currency);
    const profileAvatar = document.getElementById('profile-avatar');
    profileAvatar.hidden = true;
    profileAvatar.removeAttribute('src');
    if (settings.avatarUrl) {
      try {
        const avatar = await apiRequest('/api/profile/avatar');
        if (avatar.url) {
          profileAvatar.src = avatar.url;
          profileAvatar.hidden = false;
        }
      } catch (error) {
        notifyUser('warning', 'Profile picture unavailable', error.message);
      }
    }
    expenses = loadedExpenses;
    categories = loadedCategories;
    recurringSchedules = loadedRecurring;
    incomes = loadedIncome;
    recurringIncomeSchedules = loadedRecurringIncome;
    budgetRules = loadedBudgets;
    savingsGoals = loadedGoals;
    financialReminders = loadedReminders;
    syncCategoryControls();
    updateSettingsInputs();
    handleNavigation();
    selectedExpenseId = expenses[0]?.id || null;
    renderAll();
    document.getElementById('app-shell').hidden = false;
    loading.hidden = true;
    loading.removeAttribute('aria-busy');
    document.getElementById('auth-screen').hidden = true;
    if (accountPayload.realtimeEnabled) startRealtimeUpdates();
  } catch (error) {
    console.error('Unable to load dashboard state:', error);
    loading.hidden = true;
    loading.removeAttribute('aria-busy');
    showAuthScreen(error.message || 'Unable to load your account.');
  }
}

function stopRealtimeUpdates() {
  if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
  realtimeRefreshTimer = null;
  realtimeSource?.close();
  realtimeSource = null;
}

function startRealtimeUpdates() {
  stopRealtimeUpdates();
  if (!window.EventSource) return;
  realtimeSource = new EventSource('/api/realtime');
  realtimeSource.onmessage = (event) => {
    let update;
    try {
      update = JSON.parse(event.data);
    } catch (error) {
      console.error('Received an invalid Supabase Realtime event:', error);
      return;
    }
    if (update.error) {
      notifyUser('warning', 'Live updates unavailable', 'SpendWise will continue working; reload the dashboard to refresh your data.');
      return;
    }
    if (realtimeRefreshTimer) clearTimeout(realtimeRefreshTimer);
    realtimeRefreshTimer = setTimeout(() => {
      realtimeRefreshTimer = null;
      refreshDashboardData();
    }, 250);
  };
}

async function refreshDashboardData() {
  if (!account) return;
  try {
    const [
      settings,
      loadedExpenses,
      loadedCategories,
      loadedRecurring,
      loadedIncome,
      loadedRecurringIncome,
      loadedBudgets,
      loadedGoals,
      loadedReminders
    ] = await Promise.all([
      apiRequest('/api/settings'),
      apiRequest('/api/expenses'),
      apiRequest('/api/categories'),
      apiRequest('/api/recurring'),
      apiRequest('/api/income'),
      apiRequest('/api/recurring-income'),
      apiRequest('/api/budgets'),
      apiRequest('/api/goals'),
      apiRequest('/api/reminders')
    ]);
    const refreshedBudget = Number(settings?.monthlyBudget);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings) ||
        !String(settings.displayName || '').trim() || !Number.isFinite(refreshedBudget) ||
        refreshedBudget <= 0 || !supportedCurrencies.includes(settings.currency)) {
      throw new Error('The server returned invalid updated account settings.');
    }
    if (![loadedExpenses, loadedCategories, loadedRecurring, loadedIncome, loadedRecurringIncome,
      loadedBudgets, loadedGoals, loadedReminders].every(Array.isArray)) {
      throw new Error('The server returned incomplete updated data.');
    }
    displayName = settings.displayName;
    monthlyBudget = refreshedBudget;
    currency = settings.currency;
    currencyFormatter = createCurrencyFormatter(currency);
    expenses = loadedExpenses;
    categories = loadedCategories;
    recurringSchedules = loadedRecurring;
    incomes = loadedIncome;
    recurringIncomeSchedules = loadedRecurringIncome;
    budgetRules = loadedBudgets;
    savingsGoals = loadedGoals;
    financialReminders = loadedReminders;
    if (!expenses.some((expense) => expense.id === selectedExpenseId)) {
      selectedExpenseId = expenses[0]?.id || null;
    }
    syncCategoryControls();
    updateSettingsInputs();
    scheduleRender();
  } catch (error) {
    if (/session expired|multi-factor sign-in/i.test(error.message)) {
      stopRealtimeUpdates();
      account = null;
      showAuthScreen('Your session expired. Please sign in again.');
      return;
    }
    notifyUser('error', 'Could not refresh dashboard data', error.message);
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
let activePageId = null;
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
const budgetRuleCategory = document.getElementById('budget-rule-category');
const categoryFilterControl = document.getElementById('category-filter-control');
const categoryFilterTrigger = document.getElementById('category-filter-trigger');
const categoryFilterValue = document.getElementById('category-filter-value');
const categoryFilterOptions = document.getElementById('category-filter-options');
const currencySelect = document.getElementById('default-currency');
const currencySelectWrap = document.getElementById('currency-select-wrap');
const currencySelectTrigger = document.getElementById('currency-select-trigger');
const currencySelectValue = document.getElementById('currency-select-value');
const currencySelectOptions = document.getElementById('currency-select-options');
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

async function runWithLoadingState(button, loadingLabel, action) {
  if (!button) return action();

  const originalMarkup = button.innerHTML;
  const wasDisabled = button.disabled;
  const previousBusyValue = button.getAttribute('aria-busy');
  const form = button.closest('form');
  const previousFormBusyValue = form?.getAttribute('aria-busy') ?? null;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  form?.setAttribute('aria-busy', 'true');
  button.textContent = loadingLabel;

  try {
    return await action();
  } finally {
    button.innerHTML = originalMarkup;
    button.disabled = wasDisabled;
    if (previousBusyValue === null) button.removeAttribute('aria-busy');
    else button.setAttribute('aria-busy', previousBusyValue);
    if (form && previousFormBusyValue === null) form.removeAttribute('aria-busy');
    else form?.setAttribute('aria-busy', previousFormBusyValue);
  }
}

function setFormMessage(element, type, message) {
  if (!element) return;
  const safeType = ['success', 'warning', 'error', 'info'].includes(type) ? type : 'info';
  element.className = `form-message form-message--${safeType}`;
  element.textContent = message || '';
  element.hidden = !message;
  element.setAttribute('role', safeType === 'error' ? 'alert' : 'status');
}

function showToast(type, title, message) {
  const safeType = ['success', 'warning', 'error', 'info'].includes(type) ? type : 'info';
  const iconByType = {
    success: '<circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16.5 9" />',
    warning: '<path d="M10.3 4.7 2.9 17.5A1.7 1.7 0 0 0 4.4 20h15.2a1.7 1.7 0 0 0 1.5-2.5L13.7 4.7a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4m0 3h.01" />',
    error: '<circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" />',
    info: '<circle cx="12" cy="12" r="9" /><path d="M12 11v5m0-8h.01" />'
  };
  const toast = document.createElement('div');
  toast.className = `toast toast--${safeType}`;
  toast.setAttribute('role', safeType === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-atomic', 'true');

  const header = document.createElement('div');
  header.className = 'toast-header';
  const icon = document.createElement('span');
  icon.className = 'toast-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `<svg viewBox="0 0 24 24">${iconByType[safeType]}</svg>`;
  const copy = document.createElement('div');
  copy.className = 'toast-copy';
  const heading = document.createElement('strong');
  heading.textContent = title;
  copy.append(heading);

  const controls = document.createElement('div');
  controls.className = 'toast-controls';
  const detailId = `toast-detail-${crypto.randomUUID()}`;
  const expand = document.createElement('button');
  expand.className = 'toast-expand';
  expand.type = 'button';
  expand.setAttribute('aria-label', 'Hide notification details');
  expand.setAttribute('aria-expanded', 'true');
  expand.setAttribute('aria-controls', detailId);
  expand.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 14 6-6 6 6" /></svg>';

  const dismiss = document.createElement('button');
  dismiss.className = 'toast-dismiss';
  dismiss.type = 'button';
  dismiss.setAttribute('aria-label', 'Dismiss notification');
  dismiss.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>';

  if (!message) expand.hidden = true;
  controls.append(expand, dismiss);
  header.append(icon, copy, controls);

  const detail = document.createElement('p');
  detail.className = 'toast-detail';
  detail.id = detailId;
  detail.textContent = message;

  const footer = document.createElement('button');
  footer.className = 'toast-timer';
  footer.type = 'button';
  const timerCopy = document.createElement('span');
  timerCopy.className = 'toast-timer-copy';
  const timerProgress = document.createElement('span');
  timerProgress.className = 'toast-timer-progress';
  timerProgress.setAttribute('aria-hidden', 'true');
  const timerProgressFill = document.createElement('span');
  timerProgressFill.className = 'toast-timer-progress-fill';
  timerProgress.append(timerProgressFill);
  footer.append(timerCopy, timerProgress);

  toast.append(header, detail, footer);
  dismiss.addEventListener('click', () => dismissToast(toast));
  expand.addEventListener('click', () => {
    const isExpanded = expand.getAttribute('aria-expanded') === 'true';
    toast.classList.toggle('is-collapsed', isExpanded);
    expand.setAttribute('aria-expanded', String(!isExpanded));
    expand.setAttribute('aria-label', `${isExpanded ? 'Show' : 'Hide'} notification details`);
    if (isExpanded && timer.paused) {
      timer.paused = false;
      timer.deadline = Date.now() + timer.remaining;
      timer.interval = window.setInterval(() => updateToastTimer(timer), 100);
      updateToastTimer(timer);
    }
  });

  const timer = {
    toast,
    interval: null,
    duration: safeType === 'error' ? 15000 : 10000,
    remaining: safeType === 'error' ? 15000 : 10000,
    deadline: 0,
    paused: false,
    copy: timerCopy,
    progress: timerProgressFill,
    button: footer
  };
  footer.addEventListener('click', () => {
    if (timer.paused) {
      timer.paused = false;
      timer.deadline = Date.now() + timer.remaining;
      timer.interval = window.setInterval(() => updateToastTimer(timer), 100);
    } else {
      timer.remaining = Math.max(timer.deadline - Date.now(), 0);
      timer.paused = true;
      window.clearInterval(timer.interval);
      timer.interval = null;
    }
    updateToastTimer(timer);
  });

  if (activeToastTimer?.interval) window.clearInterval(activeToastTimer.interval);
  toastRegion.replaceChildren(toast);
  activeToastTimer = timer;
  timer.deadline = Date.now() + timer.duration;
  timer.interval = window.setInterval(() => updateToastTimer(timer), 100);
  updateToastTimer(timer);
}

function updateToastTimer(timer) {
  if (activeToastTimer !== timer) return;
  timer.remaining = timer.paused
    ? timer.remaining
    : Math.max(timer.deadline - Date.now(), 0);
  const seconds = Math.ceil(timer.remaining / 1000);
  timer.copy.textContent = timer.paused
    ? `Notification paused at ${seconds} seconds. Click to resume.`
    : `This notification will close in ${seconds} seconds. Click to pause.`;
  timer.button.setAttribute(
    'aria-label',
    timer.paused ? 'Resume notification auto-dismiss timer' : 'Pause notification auto-dismiss timer'
  );
  timer.progress.style.width = `${(timer.remaining / timer.duration) * 100}%`;
  if (timer.remaining === 0) dismissToast(timer.toast);
}

function dismissToast(toast) {
  if (activeToastTimer?.toast === toast) {
    window.clearInterval(activeToastTimer.interval);
    activeToastTimer = null;
  }
  toast.remove();
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

function animateUI(targets, options = {}) {
  const gsap = window.gsap;
  if (!gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const elements = [...targets].filter((element) => element && !element.hidden);
  if (!elements.length) return;

  gsap.fromTo(
    elements,
    { autoAlpha: 0, y: 8 },
    {
      autoAlpha: 1,
      y: 0,
      duration: options.duration || 0.32,
      stagger: options.stagger || 0.045,
      ease: 'power2.out',
      clearProps: 'opacity,visibility,transform',
      overwrite: 'auto'
    }
  );
}

function animateAuthContent() {
  const activeForm = document.querySelector(
    '#login-form:not([hidden]), #register-form:not([hidden]), #mfa-setup-form:not([hidden]), #mfa-verify-form:not([hidden]), #mfa-optional-panel:not([hidden])'
  );

  animateUI([
    document.querySelector('.auth-hero'),
    ...(activeForm ? activeForm.querySelectorAll('.form-group, .auth-step-copy, .auth-secret-card, .primary-button') : []),
    document.getElementById('auth-social-options'),
    document.getElementById('auth-message'),
    document.getElementById('auth-mode-toggle')
  ]);
}

function showAuthScreen(message = '') {
  stopRealtimeUpdates();
  document.getElementById('app-loading').hidden = true;
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

function showOptionalMfaChoice() {
  document.getElementById('login-form').hidden = true;
  document.getElementById('register-form').hidden = true;
  document.getElementById('password-reset-form').hidden = true;
  document.getElementById('password-update-form').hidden = true;
  document.getElementById('mfa-setup-form').hidden = true;
  document.getElementById('mfa-verify-form').hidden = true;
  document.getElementById('mfa-optional-panel').hidden = false;
  document.getElementById('recovery-codes-panel').hidden = true;
  document.getElementById('forgot-password-button').hidden = true;
  document.getElementById('auth-social-options').hidden = true;
  document.getElementById('auth-mode-toggle').hidden = true;
  document.getElementById('auth-resend-verification').hidden = true;
  document.getElementById('auth-back-to-login').hidden = true;
  document.getElementById('auth-title').textContent = 'Authenticator is optional';
  animateAuthContent();
}

async function beginOptionalMfaSetup() {
  document.getElementById('mfa-optional-panel').hidden = true;
  document.getElementById('auth-title').textContent = 'Set up an authenticator';
  try {
    const setup = await apiRequest('/api/auth/mfa/setup');
    mfaFactorId = setup.factorId || null;
    document.getElementById('mfa-secret').textContent = setup.secret;
    document.getElementById('mfa-setup-form').hidden = false;
    document.getElementById('mfa-setup-code').focus();
    animateAuthContent();
  } catch (error) {
    notifyUser('error', 'Authenticator setup failed', error.message);
    showOptionalMfaChoice();
  }
}

function setAuthMode(mode) {
  const isRegister = mode === 'register';
  document.getElementById('login-form').hidden = isRegister;
  document.getElementById('register-form').hidden = !isRegister;
  document.getElementById('password-reset-form').hidden = true;
  document.getElementById('password-update-form').hidden = true;
  document.getElementById('mfa-optional-panel').hidden = true;
  document.getElementById('forgot-password-button').hidden = isRegister;
  document.getElementById('mfa-setup-form').hidden = true;
  document.getElementById('mfa-verify-form').hidden = true;
  document.getElementById('recovery-codes-panel').hidden = true;
  document.getElementById('auth-social-options').hidden = false;
  document.getElementById('auth-resend-verification').hidden = true;
  document.getElementById('auth-back-to-login').hidden = true;
  document.getElementById('auth-mode-toggle').hidden = false;
  document.getElementById('auth-title').textContent = isRegister ? 'Create your account' : 'Welcome back';
  document.getElementById('auth-mode-toggle').textContent = isRegister ? 'Already have an account? Sign in' : 'Create an account';
  setFormMessage(document.getElementById('auth-message'), 'info', '');
  document.getElementById('auth-mode-toggle').dataset.mode = isRegister ? 'login' : 'register';
  animateAuthContent();
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

function getCurrentMonthKey(date = new Date()) {
  return toISO(new Date(date.getFullYear(), date.getMonth(), 1)).slice(0, 7);
}

function getCurrentMonthExpenses(date = new Date()) {
  const month = getCurrentMonthKey(date);
  return expenses.filter((expense) => expense.date.slice(0, 7) === month);
}

function formatCurrency(amount) {
  return currencyFormatter.format(amount);
}

function moneyToCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function centsToMoney(cents) {
  return cents / 100;
}

function sumMoney(items, amountFor = (item) => item.amount) {
  return centsToMoney(items.reduce((total, item) => total + moneyToCents(amountFor(item)), 0));
}

function subtractMoney(left, right) {
  return centsToMoney(moneyToCents(left) - moneyToCents(right));
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
    Food: 'food',
    Transport: 'transport',
    Housing: 'housing',
    Entertainment: 'entertainment',
    Savings: 'savings',
    Utilities: 'utilities',
    Other: 'other'
  };
  return knownIcons[name] || 'tag';
}

function iconMarkup(name, classes = '') {
  const className = classes ? `hugeicon ${classes}` : 'hugeicon';
  return `<svg class="${className}" aria-hidden="true"><use href="assets/hugeicons.svg#${name}"></use></svg>`;
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
  return sumMoney(expenses.filter((expense) => expense.category === categoryName));
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
  const monthExpenses = getCurrentMonthExpenses(now);
  const totalSpent = sumMoney(monthExpenses);
  const allTimeSpent = sumMoney(expenses);
  const monthToDateTotal = sumMoney(monthExpenses.filter((expense) => expense.date <= toISO(now)));
  const remaining = subtractMoney(monthlyBudget, totalSpent);
  const budgetUsed = monthlyBudget ? (totalSpent / monthlyBudget) * 100 : 0;
  const budgetPercentage = Math.round(budgetUsed);
  const cappedBudgetPercentage = Math.min(Math.max(budgetUsed, 0), 100);
  const dailyAverage = monthToDateTotal / now.getDate();
  const monthLabel = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

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
  document.getElementById('expenses-total-spent').textContent = formatCurrency(allTimeSpent);
  document.getElementById('expenses-month-spent').textContent = formatCurrency(totalSpent);
  document.getElementById('expenses-month-label').textContent =
    now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  document.getElementById('expenses-daily-average').textContent = formatCurrency(dailyAverage);
  document.getElementById('monthly-budget').textContent = formatCurrency(monthlyBudget);
  document.getElementById('remaining-balance').textContent = formatCurrency(remaining);
  document.getElementById('budget-used').textContent = `${budgetPercentage}%`;
  document.getElementById('budget-progress').setAttribute('aria-valuenow', String(Math.min(budgetPercentage, 100)));
  document.getElementById('budget-progress').setAttribute(
    'aria-valuetext',
    `${budgetPercentage}% of monthly budget used`
  );
  document.getElementById('budget-progress-bar').style.width = `${cappedBudgetPercentage}%`;
  document.getElementById('budget-progress').classList.toggle('is-over-budget', budgetUsed > 100);
  document.getElementById('budget-daily').textContent = formatCurrency(dailyAverage);
  document.getElementById('activity-transactions').textContent = String(monthExpenses.length);
  document.getElementById('activity-average').textContent = formatCurrency(monthExpenses.length ? totalSpent / monthExpenses.length : 0);
  document.getElementById('activity-daily').textContent = formatCurrency(dailyAverage);

  document.getElementById('analytics-breakdown-period').textContent = monthLabel;
  document.getElementById('analytics-total').textContent = formatCurrency(totalSpent);
  const monthIncome = incomes
    .filter((income) => income.date.slice(0, 7) === getCurrentMonthKey(now))
    .reduce((total, income) => total + moneyToCents(income.amount), 0);
  const monthIncomeAmount = centsToMoney(monthIncome);
  const balance = subtractMoney(monthIncomeAmount, totalSpent);
  document.getElementById('analytics-income-total').textContent = formatCurrency(monthIncomeAmount);
  document.getElementById('analytics-balance-total').textContent = formatCurrency(balance);
  document.getElementById('analytics-balance-total').classList.toggle('is-negative', balance < 0);

  const analyticsBudgetUsed = document.getElementById('analytics-budget-used');
  const analyticsBudgetProgress = document.getElementById('analytics-budget-progress');
  const analyticsBudgetProgressBar = document.getElementById('analytics-budget-progress-bar');
  analyticsBudgetUsed.textContent = `${budgetPercentage}%`;
  analyticsBudgetProgress.setAttribute('aria-valuenow', String(Math.min(budgetPercentage, 100)));
  analyticsBudgetProgress.setAttribute(
    'aria-valuetext',
    monthlyBudget
      ? `${budgetPercentage}% of monthly budget used`
      : 'No monthly budget set'
  );
  analyticsBudgetProgressBar.style.width = `${cappedBudgetPercentage}%`;
  analyticsBudgetProgress.classList.toggle('is-over-budget', budgetUsed > 100);
  document.getElementById('analytics-budget-detail').textContent = monthlyBudget
    ? `${formatCurrency(totalSpent)} of ${formatCurrency(monthlyBudget)}`
    : 'No monthly budget set';
  document.getElementById('analytics-budget-remaining').textContent = monthlyBudget
    ? budgetUsed > 100
      ? `${formatCurrency(totalSpent - monthlyBudget)} over`
      : `${formatCurrency(monthlyBudget - totalSpent)} left`
    : '';

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

      await runWithLoadingState(deleteButton, 'Deleting…', async () => {
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
    });
  }
}

function renderExpenseTable() {
  const tableBody = document.getElementById('expense-table-body');
  const resultCount = document.getElementById('expense-result-count');
  const query = document.getElementById('expense-table-search').value.trim().toLocaleLowerCase();
  const now = new Date();
  const today = toISO(now);
  const monthStart = getCurrentMonthKey(now);
  const thirtyDaysAgo = toISO(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
  const visible = getVisibleExpenses().filter((expense) => {
    const matchesLocalCategory = appliedExpenseTableCategory === 'all' ||
      expense.category === appliedExpenseTableCategory;
    const matchesPeriod = appliedExpenseTablePeriod === 'all' ||
      (appliedExpenseTablePeriod === 'month' && expense.date.slice(0, 7) === monthStart) ||
      (appliedExpenseTablePeriod === '30' && expense.date >= thirtyDaysAgo && expense.date <= today);
    const haystack = `${expense.name} ${expense.category} ${getCategoryLabel(expense.category)} ${expense.description || ''} ${expense.amount} ${expense.date}`.toLocaleLowerCase();
    return matchesLocalCategory && matchesPeriod && (!query || haystack.includes(query));
  });
  const pageSize = 5;
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  expenseTablePage = Math.min(expenseTablePage, pageCount);
  const start = (expenseTablePage - 1) * pageSize;
  const pageExpenses = visible.slice(start, start + pageSize);
  tableBody.replaceChildren();

  if (!visible.length) {
    tableBody.innerHTML = '<tr><td colspan="5" class="empty-state">No expenses match these filters.</td></tr>';
  }

  pageExpenses.forEach((expense) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="expense-date-cell">${formatLongDate(expense.date)}</td>
      <td class="expense-description-cell">
        <strong>${escapeHTML(expense.name)}</strong>
        ${expense.description ? `<small>${escapeHTML(expense.description)}</small>` : ''}
      </td>
      <td><span class="expense-category-chip">${iconMarkup(getCategoryIcon(expense.category))}${escapeHTML(getCategoryLabel(expense.category))}</span></td>
      <td class="expense-amount-cell">−${formatCurrency(expense.amount)}</td>
      <td class="expense-row-actions">
        <button class="expense-row-edit" type="button" aria-label="Edit ${escapeHTML(expense.name)}">Edit</button>
        <button class="expense-row-delete" type="button" aria-label="Delete ${escapeHTML(expense.name)}">Delete</button>
      </td>
    `;
    row.addEventListener('click', () => {
      selectedExpenseId = expense.id;
      renderTransactionList();
      renderSelectedExpense();
    });
    row.querySelector('.expense-row-edit').addEventListener('click', (event) => {
      event.stopPropagation();
      openExpenseDialog(expense);
    });
    row.querySelector('.expense-row-delete').addEventListener('click', async (event) => {
      event.stopPropagation();
      const deleteButton = event.currentTarget;
      if (!window.confirm(`Delete ${expense.name}?`)) return;
      await runWithLoadingState(deleteButton, 'Deleting…', async () => {
        try {
          await apiRequest(`/api/expenses/${encodeURIComponent(expense.id)}`, { method: 'DELETE' });
          expenses = expenses.filter((entry) => entry.id !== expense.id);
          if (selectedExpenseId === expense.id) selectedExpenseId = expenses[0]?.id || null;
          notifyUser('success', 'Expense deleted', `${expense.name} was removed.`);
          scheduleRender();
        } catch (error) {
          setFormMessage(expenseFormMessage, 'error', error.message);
          notifyUser('error', 'Expense deletion failed', error.message);
        }
      });
    });
    tableBody.appendChild(row);
  });

  const displayedStart = visible.length ? start + 1 : 0;
  const displayedEnd = Math.min(start + pageSize, visible.length);
  resultCount.textContent = `Showing ${displayedStart}–${displayedEnd} of ${visible.length} expenses`;
  renderExpensePagination(pageCount);
}

function renderExpensePagination(pageCount) {
  const pagination = document.getElementById('expense-pagination');
  pagination.replaceChildren();
  if (pageCount <= 1) return;

  const addButton = (label, page, { disabled = false, current = false, accessibleLabel = label } = {}) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'expense-page-button';
    button.textContent = label;
    button.setAttribute('aria-label', accessibleLabel);
    button.disabled = disabled;
    if (current) button.setAttribute('aria-current', 'page');
    button.addEventListener('click', () => {
      expenseTablePage = page;
      renderExpenseTable();
    });
    pagination.appendChild(button);
  };

  addButton('‹', expenseTablePage - 1, {
    disabled: expenseTablePage === 1,
    accessibleLabel: 'Previous page'
  });
  const firstPage = Math.max(1, Math.min(expenseTablePage - 1, pageCount - 2));
  const lastPage = Math.min(pageCount, firstPage + 2);
  for (let page = firstPage; page <= lastPage; page += 1) {
    addButton(String(page), page, { current: page === expenseTablePage, accessibleLabel: `Page ${page}` });
  }
  if (lastPage < pageCount - 1) {
    const ellipsis = document.createElement('span');
    ellipsis.className = 'expense-page-ellipsis';
    ellipsis.textContent = '…';
    pagination.appendChild(ellipsis);
  }
  if (lastPage < pageCount) {
    addButton(String(pageCount), pageCount, {
      current: pageCount === expenseTablePage,
      accessibleLabel: `Page ${pageCount}`
    });
  }
  addButton('›', expenseTablePage + 1, {
    disabled: expenseTablePage === pageCount,
    accessibleLabel: 'Next page'
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
        <span class="category-icon" aria-hidden="true">${iconMarkup(getCategoryIcon(category.name))}</span>
        <strong class="category-card-title">${escapeHTML(category.label)}</strong>
      </span>
      <span class="muted-text category-card-description">${escapeHTML(category.description)}</span>
      <span class="amount">${formatCurrency(total)}</span>
      <span class="category-card-footer">
        <span class="category-card-count">${count} ${count === 1 ? 'transaction' : 'transactions'}</span>
        <span class="category-card-action">View expenses ${iconMarkup('external-link')}</span>
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
        ${iconMarkup(getCategoryIcon(category.name))}
        <span>${escapeHTML(category.label)}</span>
      </span>
      <strong>${formatCurrency(getCategoryTotal(category.name))}</strong>
    `;
    item.addEventListener('click', () => openCategoryExpenses(category.name));
    list.appendChild(item);
  });
}

function renderAnalyticsBars() {
  const monthExpenses = getCurrentMonthExpenses();
  const total = sumMoney(monthExpenses);
  const list = document.getElementById('analytics-category-list');
  list.replaceChildren();

  if (!monthExpenses.length) {
    list.innerHTML = '<p class="empty-state">No expenses recorded this month yet.</p>';
    return;
  }

  const analyticsCategories = [...categories];
  const knownCategories = new Set(analyticsCategories.map((category) => category.name));
  monthExpenses.forEach((expense) => {
    if (!knownCategories.has(expense.category)) {
      knownCategories.add(expense.category);
      analyticsCategories.push({ name: expense.category, label: expense.category });
    }
  });

  const totalsByCategory = monthExpenses.reduce((totals, expense) => {
    totals.set(expense.category, (totals.get(expense.category) || 0) + moneyToCents(expense.amount));
    return totals;
  }, new Map());

  const rankedCategories = analyticsCategories
    .map((category) => ({
      ...category,
      amount: centsToMoney(totalsByCategory.get(category.name) || 0)
    }))
    .filter((category) => category.amount > 0)
    .sort((first, second) => second.amount - first.amount);
  const visibleCategories = rankedCategories.slice(0, 3).map((category) => ({
    ...category,
    percentage: (category.amount / total) * 100,
    icon: getCategoryIcon(category.name),
    interactive: true
  }));
  const otherCategories = rankedCategories.slice(3);
  if (otherCategories.length) {
    const otherTotal = sumMoney(otherCategories);
    visibleCategories.push({
      name: 'Others',
      label: 'Others',
      amount: otherTotal,
      percentage: (otherTotal / total) * 100,
      icon: 'layers',
      interactive: false
    });
  }

  visibleCategories.forEach((category) => {
    const percentageLabel = Math.round(category.percentage);
    const progressPercentage = Math.min(Math.max(category.percentage, 0), 100);
    const row = document.createElement('div');
    row.className = 'analytics-row';
    row.innerHTML = `
      <span class="analytics-category-icon" aria-hidden="true">${iconMarkup(category.icon)}</span>
      <span class="analytics-category-details">
        ${category.interactive
          ? `<button class="analytics-category-button" type="button" aria-label="View ${escapeHTML(category.label)} expenses">${escapeHTML(category.label)}</button>`
          : `<span class="analytics-category-label">${escapeHTML(category.label)}</span>`}
        <span class="analytics-category-progress" role="progressbar" aria-label="${escapeHTML(category.label)} share of monthly spending" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercentage.toFixed(1)}" aria-valuetext="${percentageLabel}% (${formatCurrency(category.amount)} of ${formatCurrency(total)})">
          <span class="analytics-category-progress-fill" style="width:${progressPercentage}%"></span>
        </span>
      </span>
      <strong class="analytics-category-percent">${percentageLabel}%</strong>
    `;
    row.querySelector('.analytics-category-button')
      ?.addEventListener('click', () => openCategoryExpenses(category.name));
    list.appendChild(row);
  });
}

function renderAnalyticsTrend() {
  const range = Number(document.getElementById('analytics-range').value);
  const now = new Date();
  const months = Array.from({ length: range }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (range - index - 1), 1);
    const key = getCurrentMonthKey(date);
    const expensesTotal = expenses
      .filter((expense) => expense.date.slice(0, 7) === key)
      .reduce((total, expense) => total + moneyToCents(expense.amount), 0);
    const incomeTotal = incomes
      .filter((income) => income.date.slice(0, 7) === key)
      .reduce((total, income) => total + moneyToCents(income.amount), 0);
    return {
      label: date.toLocaleDateString('en-US', { month: 'short' }),
      expenses: centsToMoney(expensesTotal),
      income: centsToMoney(incomeTotal)
    };
  });

  const height = 300;
  const left = 64;
  const right = 628;
  const top = 18;
  const bottom = 236;
  const maximum = Math.max(...months.flatMap((month) => [month.expenses, month.income]), 1);
  const step = maximum / 4;
  const pointsFor = (key) => months.map((month, index) => ({
    x: left + (index / Math.max(months.length - 1, 1)) * (right - left),
    y: bottom - (month[key] / maximum) * (bottom - top),
    value: month[key]
  }));
  const toSmoothPath = (points) => points.reduce((path, point, index) => {
    if (index === 0) return `M ${point.x} ${point.y}`;
    const previous = points[index - 1];
    const midpoint = (previous.x + point.x) / 2;
    return `${path} C ${midpoint} ${previous.y}, ${midpoint} ${point.y}, ${point.x} ${point.y}`;
  }, '');
  const expensesPoints = pointsFor('expenses');
  const incomePoints = pointsFor('income');
  const expensesPath = toSmoothPath(expensesPoints);
  const areaPath = `${expensesPath} L ${right} ${bottom} L ${left} ${bottom} Z`;
  const grid = document.getElementById('analytics-chart-grid');
  const labels = document.getElementById('analytics-chart-labels');
  const pointGroup = document.getElementById('analytics-chart-points');
  const svgNamespace = 'http://www.w3.org/2000/svg';
  grid.replaceChildren();
  labels.replaceChildren();
  pointGroup.replaceChildren();

  for (let index = 0; index <= 4; index += 1) {
    const y = bottom - (index / 4) * (bottom - top);
    const gridLine = document.createElementNS(svgNamespace, 'line');
    gridLine.setAttribute('x1', String(left));
    gridLine.setAttribute('x2', String(right));
    gridLine.setAttribute('y1', String(y));
    gridLine.setAttribute('y2', String(y));
    grid.appendChild(gridLine);

    const valueLabel = document.createElementNS(svgNamespace, 'text');
    valueLabel.setAttribute('x', String(left - 12));
    valueLabel.setAttribute('y', String(y + 4));
    valueLabel.setAttribute('text-anchor', 'end');
    valueLabel.textContent = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(step * index);
    labels.appendChild(valueLabel);
  }

  months.forEach((month, index) => {
    const x = left + (index / Math.max(months.length - 1, 1)) * (right - left);
    const monthLabel = document.createElementNS(svgNamespace, 'text');
    monthLabel.setAttribute('x', String(x));
    monthLabel.setAttribute('y', String(height - 8));
    monthLabel.setAttribute('text-anchor', 'middle');
    monthLabel.textContent = month.label;
    labels.appendChild(monthLabel);
  });

  [
    { points: expensesPoints, className: 'analytics-chart-point-expenses', label: 'Expenses' },
    { points: incomePoints, className: 'analytics-chart-point-income', label: 'Income' }
  ].forEach(({ points, className, label }) => {
    points.forEach((point) => {
      const circle = document.createElementNS(svgNamespace, 'circle');
      circle.setAttribute('cx', String(point.x));
      circle.setAttribute('cy', String(point.y));
      circle.setAttribute('r', '4');
      circle.setAttribute('class', className);
      circle.setAttribute('aria-hidden', 'true');
      circle.setAttribute('data-tooltip', `${label}: ${formatCurrency(point.value)}`);
      pointGroup.appendChild(circle);
    });
  });

  document.getElementById('analytics-chart-area').setAttribute('d', areaPath);
  document.getElementById('analytics-chart-expenses').setAttribute('d', expensesPath);
  document.getElementById('analytics-chart-income').setAttribute('d', toSmoothPath(incomePoints));
  document.getElementById('analytics-chart-description').textContent =
    `${range}-month trend in ${currency}: ${months.map((month) => `${month.label}, expenses ${formatCurrency(month.expenses)}, income ${formatCurrency(month.income)}`).join('; ')}.`;
}

function renderMiniBars() {
  const container = document.getElementById('weekly-spending-bars');
  container.innerHTML = '';
  const weeklyTotals = [0, 0, 0, 0, 0];

  expenses.forEach((expense) => {
    const daysAgo = Math.floor((new Date() - new Date(`${expense.date}T12:00:00`)) / 86400000);
    if (daysAgo < 0 || daysAgo >= 35) return;

    const bucket = Math.floor(daysAgo / 7);
    weeklyTotals[4 - bucket] += moneyToCents(expense.amount);
  });

  const max = Math.max(...weeklyTotals);
  const weeklyTotalsInMoney = weeklyTotals.map(centsToMoney);
  container.setAttribute(
    'aria-label',
    `Spending by week, oldest to newest: ${weeklyTotalsInMoney.map(formatCurrency).join(', ')}`
  );
  weeklyTotals.forEach((total, index) => {
    const bar = document.createElement('span');
    bar.className = 'mini-bar';
    bar.style.height = `${max ? (total / max) * 100 : 0}%`;
    bar.title = `Week ${index + 1}: ${formatCurrency(weeklyTotalsInMoney[index])}`;
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
    return sumMoney(expenses.filter((expense) => expense.date === iso));
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
    button.setAttribute('aria-label', dateValue.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    }));
    button.setAttribute('aria-pressed', String(isSelected));
    button.classList.toggle('is-selected', isSelected);
    if (hasExpense) button.classList.add('has-expense');
    if (iso === toISO(new Date())) {
      button.classList.add('is-today');
      button.setAttribute('aria-current', 'date');
    }

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
  currencySelect.value = currency;
  updateCurrencyLabels();
}

function updateCurrencyLabels() {
  document.querySelectorAll('[data-currency-code]').forEach((label) => {
    label.textContent = currencySelect.value || currency;
  });
  updateCurrencySelect();
}

function updateCurrencySelect() {
  const selectedOption = currencySelect.selectedOptions[0];
  currencySelectValue.textContent = selectedOption?.textContent || 'Choose a currency';
  Array.from(currencySelectOptions.children).forEach((optionButton) => {
    const isSelected = optionButton.dataset.value === currencySelect.value;
    optionButton.setAttribute('aria-selected', String(isSelected));
    optionButton.classList.toggle('is-selected', isSelected);
  });
}

function closeCurrencySelect(returnFocus = false) {
  currencySelectOptions.hidden = true;
  currencySelectTrigger.setAttribute('aria-expanded', 'false');
  if (returnFocus) currencySelectTrigger.focus();
}

function openCurrencySelect(focusSelected = false) {
  currencySelectOptions.hidden = false;
  currencySelectTrigger.setAttribute('aria-expanded', 'true');
  if (focusSelected) {
    currencySelectOptions.querySelector('[aria-selected="true"]')?.focus();
  }
}

function syncCurrencySelectOptions() {
  currencySelectOptions.replaceChildren();
  Array.from(currencySelect.options).forEach((option) => {
    const optionButton = document.createElement('button');
    optionButton.type = 'button';
    optionButton.className = 'currency-select-option';
    optionButton.setAttribute('role', 'option');
    optionButton.dataset.value = option.value;
    optionButton.setAttribute('aria-selected', 'false');
    optionButton.textContent = option.textContent;
    optionButton.addEventListener('click', () => {
      currencySelect.value = option.value;
      currencySelect.dispatchEvent(new Event('change', { bubbles: true }));
      closeCurrencySelect(true);
    });
    currencySelectOptions.appendChild(optionButton);
  });
  updateCurrencySelect();
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
    { element: document.getElementById('expense-table-category'), includeAll: true },
    { element: budgetRuleCategory, includeAll: true },
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
    icon.innerHTML = iconMarkup(getCategoryIcon(category.name));
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
    const icon = document.createElement('span');
    icon.className = 'category-filter-option-icon';
    icon.innerHTML = iconMarkup(option.value === 'all' ? 'layers' : getCategoryIcon(option.value));
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
      await runWithLoadingState(button, 'Removing…', async () => {
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
      await runWithLoadingState(item.querySelector('button'), 'Removing…', async () => {
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
    });
    list.appendChild(item);
  });
}

function getWeekStart(date = new Date()) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return toISO(start);
}

function renderPlanningSummary() {
  const now = new Date();
  const month = getCurrentMonthKey(now);
  const monthIncome = incomes
    .filter((income) => income.date.slice(0, 7) === month)
    .reduce((total, income) => total + moneyToCents(income.amount), 0);
  const monthIncomeAmount = centsToMoney(monthIncome);
  const monthExpenses = sumMoney(getCurrentMonthExpenses());
  const today = toISO(now);
  const monthEnd = toISO(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const plannedAmountCents = [
    ...financialReminders
      .filter((reminder) => !reminder.completed && reminder.date >= today && reminder.date <= monthEnd)
      .map((reminder) => Number(reminder.amount) || 0),
    ...recurringSchedules
      .filter((schedule) => schedule.nextRunDate >= today && schedule.nextRunDate <= monthEnd)
      .map((schedule) => Number(schedule.amount) || 0)
  ].reduce((total, amount) => total + moneyToCents(amount), 0);
  const plannedAmount = centsToMoney(plannedAmountCents);
  const remaining = subtractMoney(monthlyBudget, monthExpenses);
  const usage = monthlyBudget ? (monthExpenses / monthlyBudget) * 100 : 0;
  const percentage = Math.round(usage);
  const topGoal = [...savingsGoals].sort((first, second) =>
    (moneyToCents(second.targetAmount) - moneyToCents(second.currentAmount)) -
    (moneyToCents(first.targetAmount) - moneyToCents(first.currentAmount))
  )[0];

  document.getElementById('planning-budget-total').textContent = formatCurrency(monthlyBudget);
  document.getElementById('planning-planned-total').textContent = formatCurrency(plannedAmount);
  document.getElementById('planning-planned-percent').textContent = plannedAmount
    ? 'Upcoming scheduled costs this month'
    : 'No upcoming costs scheduled';
  document.getElementById('planning-remaining-total').textContent = formatCurrency(remaining);
  document.getElementById('planning-remaining-total').classList.toggle('is-negative', remaining < 0);
  document.getElementById('planning-remaining-caption').textContent = remaining < 0
    ? 'Over this month’s spending budget'
    : 'Available in this month’s budget';
  document.getElementById('planning-goal-summary').textContent = topGoal
    ? `${topGoal.name} · ${formatCurrency(topGoal.targetAmount)}`
    : 'Create a goal';
  document.getElementById('planning-goal-status').textContent = topGoal
    ? `${Math.round(Math.min(Math.max((topGoal.currentAmount / topGoal.targetAmount) * 100, 0), 100))}% saved`
    : 'Start saving toward a target';
  document.getElementById('planning-budget-percent').textContent = `${percentage}%`;
  document.getElementById('planning-budget-donut').style.setProperty(
    '--planning-budget-progress',
    `${Math.min(Math.max(usage, 0), 100)}%`
  );
  document.getElementById('planning-budget-donut').setAttribute(
    'aria-label',
    `${percentage}% of monthly budget used`
  );
  document.getElementById('planning-spent-amount').textContent = formatCurrency(monthExpenses);
  document.getElementById('planning-overview-remaining').textContent = formatCurrency(remaining);
  document.getElementById('planning-overview-budget').textContent = formatCurrency(monthlyBudget);
  document.getElementById('planning-income-total').textContent = formatCurrency(monthIncomeAmount);
  document.getElementById('planning-expense-total').textContent = formatCurrency(monthExpenses);
  const cashFlow = document.getElementById('planning-cash-flow');
  cashFlow.textContent = formatCurrency(monthIncome - monthExpenses);
  cashFlow.classList.toggle('is-negative', monthIncome < monthExpenses);
}

function renderUpcomingPlans() {
  const list = document.getElementById('planning-upcoming-list');
  const today = toISO(new Date());
  const plans = [
    ...financialReminders
      .filter((reminder) => !reminder.completed && reminder.date >= today)
      .map((reminder) => ({
        title: reminder.title,
        date: reminder.date,
        amount: Number(reminder.amount) || 0,
        icon: reminder.type === 'savings' ? 'savings' : 'calendar',
        label: 'Planned'
      })),
    ...recurringSchedules
      .filter((schedule) => schedule.nextRunDate >= today)
      .map((schedule) => ({
        title: schedule.name,
        date: schedule.nextRunDate,
        amount: Number(schedule.amount) || 0,
        icon: getCategoryIcon(schedule.category),
        label: 'Recurring'
      }))
  ].sort((first, second) => first.date.localeCompare(second.date)).slice(0, 4);

  list.replaceChildren();
  if (!plans.length) {
    const empty = document.createElement('p');
    empty.className = 'planning-upcoming-empty';
    empty.textContent = 'No upcoming plans yet. Add a bill or reminder to get started.';
    list.appendChild(empty);
    return;
  }

  plans.forEach((plan) => {
    const row = document.createElement('div');
    row.className = 'planning-upcoming-item';
    const icon = document.createElement('span');
    icon.className = 'planning-upcoming-icon';
    icon.setAttribute('aria-hidden', 'true');
    icon.innerHTML = iconMarkup(plan.icon);
    const name = document.createElement('strong');
    name.className = 'planning-upcoming-name';
    name.textContent = plan.title;
    const date = document.createElement('time');
    date.dateTime = plan.date;
    date.textContent = new Date(`${plan.date}T12:00:00`).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric'
    });
    const amount = document.createElement('strong');
    amount.className = 'planning-upcoming-amount';
    amount.textContent = formatCurrency(plan.amount);
    const status = document.createElement('span');
    status.className = 'planning-upcoming-status';
    status.textContent = plan.label;
    row.append(icon, name, date, amount, status);
    list.appendChild(row);
  });
}

function renderIncomeRecords() {
  const list = document.getElementById('income-list');
  const records = [...incomes].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
  list.replaceChildren();
  if (!records.length) {
    list.innerHTML = '<p class="empty-state">No income recorded yet.</p>';
    return;
  }

  records.forEach((income) => {
    const item = document.createElement('div');
    item.className = 'managed-list-item';
    item.innerHTML = `
      <span><strong>${escapeHTML(income.name)}</strong><small>${formatCurrency(income.amount)} · ${formatLongDate(income.date)}${income.description ? ` · ${escapeHTML(income.description)}` : ''}</small></span>
      <button class="secondary-button" type="button" aria-label="Remove ${escapeHTML(income.name)} income record">Remove</button>
    `;
    item.querySelector('button').addEventListener('click', async (event) => {
      await runWithLoadingState(event.currentTarget, 'Removing…', async () => {
        try {
          await apiRequest(`/api/income/${encodeURIComponent(income.id)}`, { method: 'DELETE' });
          incomes = incomes.filter((record) => record.id !== income.id);
          renderPlanning();
          notifyUser('success', 'Income removed', `${income.name} was removed.`);
        } catch (error) {
          setFormMessage(document.getElementById('income-message'), 'error', error.message);
          notifyUser('error', 'Income removal failed', error.message);
        }
      });
    });
    list.appendChild(item);
  });
}

function renderRecurringIncome() {
  const list = document.getElementById('recurring-income-list');
  list.replaceChildren();
  if (!recurringIncomeSchedules.length) {
    list.innerHTML = '<p class="empty-state">No recurring income scheduled.</p>';
    return;
  }

  recurringIncomeSchedules.forEach((schedule) => {
    const item = document.createElement('div');
    item.className = 'managed-list-item';
    item.innerHTML = `
      <span><strong>${escapeHTML(schedule.name)}</strong><small>${formatCurrency(schedule.amount)} · monthly on day ${schedule.day} · next ${formatLongDate(schedule.nextRunDate)}</small></span>
      <button class="secondary-button" type="button" aria-label="Remove ${escapeHTML(schedule.name)} recurring income schedule">Remove</button>
    `;
    item.querySelector('button').addEventListener('click', async (event) => {
      await runWithLoadingState(event.currentTarget, 'Removing…', async () => {
        try {
          await apiRequest(`/api/recurring-income/${encodeURIComponent(schedule.id)}`, { method: 'DELETE' });
          recurringIncomeSchedules = recurringIncomeSchedules.filter((itemSchedule) => itemSchedule.id !== schedule.id);
          renderPlanning();
          notifyUser('success', 'Income schedule removed', `${schedule.name} will no longer repeat.`);
        } catch (error) {
          setFormMessage(document.getElementById('recurring-income-message'), 'error', error.message);
          notifyUser('error', 'Schedule removal failed', error.message);
        }
      });
    });
    list.appendChild(item);
  });
}

function renderBudgetRules() {
  const list = document.getElementById('budget-rule-list');
  list.replaceChildren();
  if (!budgetRules.length) {
    list.innerHTML = '<p class="empty-state">No weekly or category-specific limits set.</p>';
    return;
  }

  const today = toISO(new Date());
  const month = getCurrentMonthKey();
  const weekStart = getWeekStart();
  budgetRules.forEach((budget) => {
    const inPeriod = expenses.filter((expense) => {
      const inDateRange = budget.period === 'weekly'
        ? expense.date >= weekStart && expense.date <= today
        : expense.date.slice(0, 7) === month;
      return inDateRange && (budget.category === 'all' || expense.category === budget.category);
    });
    const spent = sumMoney(inPeriod);
    const usage = budget.amount ? (spent / budget.amount) * 100 : 0;
    const percentage = Math.min(Math.max(usage, 0), 100);
    const label = budget.category === 'all' ? 'All expenses' : getCategoryLabel(budget.category);
    if (usage > 100 && !budgetRuleNoticeIds.has(budget.id)) {
      budgetRuleNoticeIds.add(budget.id);
      notifyUser('warning', 'Spending limit exceeded',
        `${label} ${budget.period} spending is ${formatCurrency(subtractMoney(spent, budget.amount))} over its limit.`);
    } else if (usage <= 100) {
      budgetRuleNoticeIds.delete(budget.id);
    }
    const item = document.createElement('div');
    item.className = 'planning-budget-item';
    item.innerHTML = `
      <div class="planning-budget-heading">
        <span><strong>${escapeHTML(label)}</strong><small>${budget.period === 'weekly' ? 'This week' : 'This month'}</small></span>
        <span class="planning-budget-amount">${Math.round(usage)}% used</span>
      </div>
      <div class="planning-budget-track ${usage > 100 ? 'is-over-budget' : ''}"
        role="progressbar"
        aria-label="${escapeHTML(label)} ${budget.period} budget usage"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="${Math.min(Math.round(usage), 100)}"
        aria-valuetext="${Math.round(usage)}% used">
        <span style="width:${percentage}%"></span>
      </div>
      <div class="planning-budget-foot">
        <span>${formatCurrency(spent)} of ${formatCurrency(budget.amount)}</span>
        <span class="${usage > 100 ? 'is-over-budget' : ''}">${usage > 100
          ? `${formatCurrency(subtractMoney(spent, budget.amount))} over`
          : `${formatCurrency(subtractMoney(budget.amount, spent))} left`}</span>
      </div>
      <button class="text-link" type="button" aria-label="Remove ${escapeHTML(label)} ${budget.period} budget">Remove limit</button>
    `;
    item.querySelector('button').addEventListener('click', async (event) => {
      await runWithLoadingState(event.currentTarget, 'Removing…', async () => {
        try {
          await apiRequest(`/api/budgets/${encodeURIComponent(budget.id)}`, { method: 'DELETE' });
          budgetRules = budgetRules.filter((entry) => entry.id !== budget.id);
          budgetRuleNoticeIds.delete(budget.id);
          renderBudgetRules();
          notifyUser('success', 'Spending limit removed', `${label} ${budget.period} limit was removed.`);
        } catch (error) {
          setFormMessage(document.getElementById('budget-rule-message'), 'error', error.message);
          notifyUser('error', 'Limit removal failed', error.message);
        }
      });
    });
    list.appendChild(item);
  });
}

function renderSavingsGoals() {
  const list = document.getElementById('savings-goal-list');
  list.replaceChildren();
  if (!savingsGoals.length) {
    list.innerHTML = '<p class="empty-state">Create a savings goal to start tracking your progress.</p>';
    return;
  }

  savingsGoals.forEach((goal) => {
    const progress = Math.min(Math.max((goal.currentAmount / goal.targetAmount) * 100, 0), 100);
    const item = document.createElement('article');
    item.className = 'planning-goal';
    item.innerHTML = `
      <div class="planning-budget-heading">
        <span class="planning-goal-title">
          <span class="planning-goal-icon" aria-hidden="true">${iconMarkup('target')}</span>
          <span><strong>${escapeHTML(goal.name)}</strong><small>${goal.targetDate ? `Target ${formatLongDate(goal.targetDate)}` : 'No target date'}</small></span>
        </span>
        <span class="planning-goal-percent">${Math.round(progress)}%</span>
      </div>
      <div class="planning-budget-track" role="progressbar" aria-label="${escapeHTML(goal.name)} savings progress"
        aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(progress)}"
        aria-valuetext="${Math.round(progress)}% saved">
        <span style="width:${progress}%"></span>
      </div>
      <div class="planning-budget-foot">
        <span>${formatCurrency(goal.currentAmount)} of ${formatCurrency(goal.targetAmount)}</span>
        <span>${formatCurrency(Math.max(goal.targetAmount - goal.currentAmount, 0))} to go</span>
      </div>
      <form class="goal-contribution-form">
        <label class="visually-hidden" for="goal-contribution-${escapeHTML(goal.id)}">Contribution for ${escapeHTML(goal.name)}</label>
        <input id="goal-contribution-${escapeHTML(goal.id)}" name="amount" type="number" min="0.01" max="1000000000" step="0.01" placeholder="Contribution" required />
        <button class="secondary-button" type="submit">Add savings</button>
        <button class="text-link goal-remove" type="button">Remove goal</button>
      </form>
    `;
    item.querySelector('.goal-contribution-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const amount = Number(new FormData(form).get('amount'));
      if (!Number.isFinite(amount) || amount <= 0) {
        setFormMessage(document.getElementById('savings-goal-message'), 'error', 'Enter a contribution greater than zero.');
        notifyUser('error', 'Check contribution', 'Enter a contribution greater than zero.');
        return;
      }
      await runWithLoadingState(event.submitter, 'Saving…', async () => {
        try {
          const updated = await apiRequest(`/api/goals/${encodeURIComponent(goal.id)}/contributions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount })
          });
          savingsGoals = savingsGoals.map((entry) => entry.id === goal.id ? updated : entry);
          setFormMessage(document.getElementById('savings-goal-message'), 'success', 'Savings contribution recorded.');
          renderSavingsGoals();
          notifyUser('success', 'Savings updated', `${formatCurrency(amount)} added to ${goal.name}.`);
        } catch (error) {
          setFormMessage(document.getElementById('savings-goal-message'), 'error', error.message);
          notifyUser('error', 'Contribution failed', error.message);
        }
      });
    });
    item.querySelector('.goal-remove').addEventListener('click', async (event) => {
      await runWithLoadingState(event.currentTarget, 'Removing…', async () => {
        try {
          await apiRequest(`/api/goals/${encodeURIComponent(goal.id)}`, { method: 'DELETE' });
          savingsGoals = savingsGoals.filter((entry) => entry.id !== goal.id);
          renderPlanning();
          notifyUser('success', 'Savings goal removed', `${goal.name} was removed.`);
        } catch (error) {
          setFormMessage(document.getElementById('savings-goal-message'), 'error', error.message);
          notifyUser('error', 'Goal removal failed', error.message);
        }
      });
    });
    list.appendChild(item);
  });
}

function renderReminders() {
  const list = document.getElementById('reminder-list');
  const reminders = [...financialReminders].sort((a, b) => a.date.localeCompare(b.date));
  list.replaceChildren();
  if (!reminders.length) {
    list.innerHTML = '<p class="empty-state">No bills or reminders yet.</p>';
    return;
  }

  reminders.forEach((reminder) => {
    const item = document.createElement('div');
    const daysUntil = Math.ceil((new Date(`${reminder.date}T12:00:00`) - new Date(`${toISO(new Date())}T12:00:00`)) / 86400000);
    const dueLabel = reminder.completed ? 'Completed' : daysUntil < 0 ? `${Math.abs(daysUntil)} days overdue` : daysUntil === 0 ? 'Due today' : `In ${daysUntil} days`;
    item.className = `managed-list-item planning-reminder${reminder.completed ? ' is-completed' : ''}${!reminder.completed && daysUntil <= 1 ? ' is-due' : ''}`;
    item.innerHTML = `
      <span><strong>${escapeHTML(reminder.title)}</strong><small>${formatLongDate(reminder.date)} · ${escapeHTML(dueLabel)}${reminder.amount ? ` · ${formatCurrency(reminder.amount)}` : ''}${reminder.description ? ` · ${escapeHTML(reminder.description)}` : ''}</small></span>
      <span class="planning-reminder-actions">
        <button class="secondary-button" type="button" data-action="toggle">${reminder.completed ? 'Reopen' : 'Done'}</button>
        <button class="text-link" type="button" data-action="remove" aria-label="Remove ${escapeHTML(reminder.title)} reminder">Remove</button>
      </span>
    `;
    item.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', async (event) => {
        await runWithLoadingState(event.currentTarget, button.dataset.action === 'remove' ? 'Removing…' : 'Saving…', async () => {
          try {
            if (button.dataset.action === 'toggle') {
              const updated = await apiRequest(`/api/reminders/${encodeURIComponent(reminder.id)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ completed: !reminder.completed })
              });
              financialReminders = financialReminders.map((entry) => entry.id === reminder.id ? updated : entry);
            } else {
              await apiRequest(`/api/reminders/${encodeURIComponent(reminder.id)}`, { method: 'DELETE' });
              financialReminders = financialReminders.filter((entry) => entry.id !== reminder.id);
            }
            renderPlanning();
          } catch (error) {
            setFormMessage(document.getElementById('reminder-message'), 'error', error.message);
            notifyUser('error', 'Reminder update failed', error.message);
          }
        });
      });
    });
    list.appendChild(item);
    if (!reminder.completed && daysUntil >= 0 && daysUntil <= 1 && !reminderNoticeIds.has(reminder.id)) {
      reminderNoticeIds.add(reminder.id);
      notifyUser('warning', daysUntil === 0 ? 'Reminder due today' : 'Reminder coming up', reminder.title);
    }
  });
}

const reminderNoticeIds = new Set();

function renderPlanning() {
  renderPlanningSummary();
  renderUpcomingPlans();
  renderIncomeRecords();
  renderRecurringIncome();
  renderBudgetRules();
  renderSavingsGoals();
  renderReminders();
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
  renderAnalyticsTrend();
  renderMiniBars();
  renderChart();
  renderCalendar();
  renderTimeline();
  renderManagedCategories();
  renderRecurringSchedules();
  renderPlanning();
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
  const isChangingPage = targetId !== activePageId;
  activePageId = targetId;
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
  if (isChangingPage) {
    animateUI([document.getElementById(targetId)], { duration: 0.28 });
    animateUI(Array.from(navLinks).filter((link) => link.classList.contains('active')), { duration: 0.2 });
  }
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

  await runWithLoadingState(event.submitter, isEditing ? 'Saving…' : 'Adding…', async () => {
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
        notifyUser('success', 'Expense updated', `${name} was updated successfully.`);
      } else {
        expenses.push(savedExpense);
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
});

syncCurrencySelectOptions();
currencySelect.addEventListener('change', updateCurrencyLabels);
currencySelectTrigger.addEventListener('click', () => {
  if (currencySelectOptions.hidden) openCurrencySelect();
  else closeCurrencySelect();
});
currencySelectTrigger.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    openCurrencySelect(true);
  } else if (event.key === 'Escape') {
    closeCurrencySelect();
  }
});
currencySelectOptions.addEventListener('keydown', (event) => {
  const optionButtons = Array.from(currencySelectOptions.querySelectorAll('[role="option"]'));
  const focusedIndex = optionButtons.indexOf(document.activeElement);
  let nextIndex = focusedIndex;

  if (event.key === 'ArrowDown') nextIndex = (focusedIndex + 1) % optionButtons.length;
  else if (event.key === 'ArrowUp') nextIndex = (focusedIndex - 1 + optionButtons.length) % optionButtons.length;
  else if (event.key === 'Home') nextIndex = 0;
  else if (event.key === 'End') nextIndex = optionButtons.length - 1;
  else if (event.key === 'Escape') {
    event.preventDefault();
    closeCurrencySelect(true);
    return;
  } else if (event.key === 'Tab') {
    closeCurrencySelect();
    return;
  } else {
    return;
  }

  event.preventDefault();
  optionButtons[nextIndex]?.focus();
});
document.addEventListener('pointerdown', (event) => {
  if (!currencySelectWrap.contains(event.target)) closeCurrencySelect();
});

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

  await runWithLoadingState(event.submitter, 'Saving…', async () => {
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
});

document.getElementById('profile-avatar-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const file = document.getElementById('profile-avatar-file').files[0];
  const message = document.getElementById('profile-avatar-message');
  const supportedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!file || !supportedTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
    setFormMessage(message, 'error', 'Choose a JPEG, PNG, or WebP image no larger than 5 MB.');
    return;
  }

  runWithLoadingState(event.submitter, 'Uploading…', async () => {
    try {
      const avatar = await apiRequest('/api/profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': file.type },
        body: file
      });
      const image = document.getElementById('profile-avatar');
      image.src = avatar.url;
      image.hidden = false;
      document.getElementById('profile-avatar-file').value = '';
      setFormMessage(message, 'success', 'Profile picture updated.');
    } catch (error) {
      setFormMessage(message, 'error', error.message);
      notifyUser('error', 'Profile picture upload failed', error.message);
    }
  });
});

const authModeToggle = document.getElementById('auth-mode-toggle');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const registerPassword = document.getElementById('register-password');
const passwordResetForm = document.getElementById('password-reset-form');
const passwordUpdateForm = document.getElementById('password-update-form');
let mfaFactorId = null;

authModeToggle.addEventListener('click', () => setAuthMode(authModeToggle.dataset.mode || 'register'));

document.querySelectorAll('.auth-password-toggle').forEach((button) => {
  button.addEventListener('click', () => {
    const passwordInput = document.getElementById(button.getAttribute('aria-controls'));
    const isVisible = passwordInput.type === 'password';

    passwordInput.type = isVisible ? 'text' : 'password';
    button.classList.toggle('is-visible', isVisible);
    button.setAttribute('aria-pressed', String(isVisible));
    button.setAttribute('aria-label', `${isVisible ? 'Hide' : 'Show'} password`);
    button.querySelector('span').textContent = isVisible ? 'Hide' : 'Show';

    const gsap = window.gsap;
    if (gsap && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      gsap.fromTo(button.querySelector(isVisible ? '.password-eye-off' : '.password-eye'), {
        scale: 0.8,
        rotate: -10
      }, {
        scale: 1,
        rotate: 0,
        duration: 0.2,
        ease: 'power2.out',
        clearProps: 'transform',
        overwrite: 'auto'
      });
    }
  });
});

document.querySelectorAll('#auth-screen input').forEach((input) => {
  input.addEventListener('focus', () => {
    const gsap = window.gsap;
    if (!gsap || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    gsap.fromTo(input, { scale: 0.99 }, {
      scale: 1,
      duration: 0.2,
      ease: 'power2.out',
      clearProps: 'transform',
      overwrite: 'auto'
    });
  });
});

registerPassword.addEventListener('input', () => {
  const passwordLength = registerPassword.value.length;
  const isWithinLimit = passwordLength > 0 && passwordLength <= 128;
  const rules = {
    minimum: passwordLength >= 8,
    maximum: isWithinLimit
  };

  Object.entries(rules).forEach(([rule, isValid]) => {
    const requirement = document.querySelector(`[data-password-rule="${rule}"]`);
    requirement.classList.toggle('is-valid', isValid);
    requirement.setAttribute('aria-label', `${requirement.lastElementChild.textContent}: ${isValid ? 'met' : 'not met'}`);
  });
});

document.getElementById('auth-retry').addEventListener('click', () => {
  document.getElementById('auth-retry').hidden = true;
  loadDashboardState();
});

async function showMfaChallenge(result) {
  document.getElementById('mfa-optional-panel').hidden = true;
  document.getElementById('login-form').hidden = true;
  document.getElementById('register-form').hidden = true;
  document.getElementById('password-reset-form').hidden = true;
  document.getElementById('password-update-form').hidden = true;
  document.getElementById('forgot-password-button').hidden = true;
  document.getElementById('auth-social-options').hidden = true;
  document.getElementById('auth-mode-toggle').hidden = true;
  document.getElementById('auth-resend-verification').hidden = true;
  document.getElementById('auth-back-to-login').hidden = false;
  document.getElementById('auth-title').textContent = result.setupRequired
    ? 'Set up your authenticator'
    : 'Verify it’s you';

  if (result.setupRequired) {
    const setup = await apiRequest('/api/auth/mfa/setup');
    mfaFactorId = setup.factorId;
    document.getElementById('mfa-secret').textContent = setup.secret;
    document.getElementById('mfa-setup-form').hidden = false;
    document.getElementById('mfa-setup-code').focus();
  } else {
    document.getElementById('mfa-verify-form').hidden = false;
    document.getElementById('mfa-login-code').focus();
  }
}

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
      if (!result.authenticated) {
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
    }

    if (result.mfaRequired) {
      await showMfaChallenge(result);
      return;
    }
    if (result.mfaOptional) {
      showOptionalMfaChoice();
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

document.querySelectorAll('.auth-provider-button').forEach((button) => {
  button.addEventListener('click', async () => {
    button.disabled = true;
    const label = button.querySelector('span');
    const originalText = label?.textContent;
    if (label) label.textContent = 'Connecting…';
    try {
      const result = await apiRequest('/api/auth/oauth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: button.dataset.provider })
      });
      if (!result.url || typeof result.url !== 'string') {
        throw new Error('Supabase did not return a sign-in URL.');
      }
      window.location.assign(result.url);
    } catch (error) {
      notifyUser('error', `${button.dataset.provider} sign-in failed`, error.message);
      button.disabled = false;
      if (label && originalText) label.textContent = originalText;
    }
  });
});

loginForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runWithLoadingState(event.submitter, 'Signing in…', () => submitAuthForm(loginForm, 'login'));
});

registerForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runWithLoadingState(event.submitter, 'Creating account…', () => submitAuthForm(registerForm, 'register'));
});

document.getElementById('auth-back-to-login').addEventListener('click', async (event) => {
  await runWithLoadingState(event.currentTarget, 'Returning…', async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      showAuthScreen();
    } catch (error) {
      notifyUser('error', 'Could not restart sign-in', error.message);
    }
  });
});

document.getElementById('mfa-enable-button').addEventListener('click', () => {
  runWithLoadingState(
    document.getElementById('mfa-enable-button'),
    'Preparing…',
    beginOptionalMfaSetup
  );
});

document.getElementById('mfa-continue-without-button').addEventListener('click', loadDashboardState);
document.getElementById('mfa-skip-setup').addEventListener('click', loadDashboardState);

document.getElementById('auth-resend-verification').addEventListener('click', async (event) => {
  const email = document.getElementById('login-email').value.trim();
  if (!email) {
    notifyUser('warning', 'Email needed', 'Enter the email address used for your account first.');
    document.getElementById('login-email').focus();
    return;
  }
  await runWithLoadingState(event.currentTarget, 'Sending…', async () => {
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
});

document.getElementById('mfa-setup-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await runWithLoadingState(event.submitter, 'Verifying…', async () => {
    try {
      const result = await apiRequest('/api/auth/mfa/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          factorId: mfaFactorId,
          code: document.getElementById('mfa-setup-code').value.trim()
        })
      });
      document.getElementById('mfa-setup-form').hidden = true;
      mfaFactorId = null;
      document.getElementById('auth-title').textContent = 'Save your recovery codes';
      document.getElementById('recovery-codes').textContent = result.recoveryCodes.join('\n');
      document.getElementById('recovery-codes-panel').hidden = false;
      document.getElementById('auth-social-options').hidden = true;
      document.getElementById('auth-back-to-login').hidden = true;
      document.getElementById('continue-after-recovery').focus();
      notifyUser('success', 'Authenticator verified', 'Your account now requires multi-factor authentication.');
    } catch (error) {
      notifyUser('error', 'Authenticator setup failed', error.message);
    }
  });
});

document.getElementById('mfa-verify-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  await runWithLoadingState(event.submitter, 'Verifying…', async () => {
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

document.getElementById('forgot-password-button').addEventListener('click', () => {
  const email = document.getElementById('login-email').value.trim();
  setAuthMode('login');
  document.getElementById('login-form').hidden = true;
  document.getElementById('password-reset-form').hidden = false;
  document.getElementById('forgot-password-button').hidden = true;
  document.getElementById('auth-mode-toggle').hidden = true;
  document.getElementById('auth-title').textContent = 'Reset your password';
  document.getElementById('password-reset-email').value = email;
  document.getElementById('password-reset-email').focus();
});

document.getElementById('password-reset-cancel').addEventListener('click', () => setAuthMode('login'));

passwordResetForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const button = event.submitter;
  runWithLoadingState(button, 'Sending…', async () => {
    try {
      const result = await apiRequest('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: document.getElementById('password-reset-email').value.trim() })
      });
      setFormMessage(document.getElementById('auth-message'), 'success', result.message);
      notifyUser('success', 'Check your email', result.message);
    } catch (error) {
      setFormMessage(document.getElementById('auth-message'), 'error', error.message);
      notifyUser('error', 'Password reset failed', error.message);
    }
  });
});

passwordUpdateForm.addEventListener('submit', (event) => {
  event.preventDefault();
  runWithLoadingState(event.submitter, 'Updating…', async () => {
    try {
      await apiRequest('/api/auth/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('password-update-value').value })
      });
      passwordUpdateForm.reset();
      await apiRequest('/api/auth/logout', { method: 'POST' });
      showAuthScreen('Your password has been updated. Sign in with your new password.');
    } catch (error) {
      setFormMessage(document.getElementById('auth-message'), 'error', error.message);
      notifyUser('error', 'Password update failed', error.message);
    }
  });
});

async function signOutAccount(event) {
  const button = event.currentTarget;
  await runWithLoadingState(button, 'Signing out…', async () => {
    try {
      await apiRequest('/api/auth/logout', { method: 'POST' });
      account = null;
      expenses = [];
      recurringSchedules = [];
      categories = [...defaultCategories];
      selectedExpenseId = null;
      showAuthScreen('You have been signed out.');
    } catch (error) {
      setFormMessage(document.getElementById('settings-message'), 'error', error.message);
      notifyUser('error', 'Sign-out failed', error.message);
    }
  });
}

document.getElementById('logout-button').addEventListener('click', signOutAccount);
document.getElementById('sidebar-signout').addEventListener('click', signOutAccount);

document.getElementById('category-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const input = document.getElementById('new-category-name');
  const message = document.getElementById('category-message');
  await runWithLoadingState(event.submitter, 'Adding…', async () => {
    try {
      const category = await apiRequest('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: input.value.trim() })
      });
      categories.push(category);
      form.reset();
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
  await runWithLoadingState(event.submitter, 'Adding…', async () => {
    try {
      const created = await apiRequest('/api/recurring', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const { generatedExpense, ...savedSchedule } = created;
      recurringSchedules.push(savedSchedule);
      if (generatedExpense) {
        const existingIndex = expenses.findIndex((expense) => expense.id === generatedExpense.id);
        if (existingIndex < 0) expenses.push(generatedExpense);
        else expenses[existingIndex] = generatedExpense;
      }
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
});

document.getElementById('income-date').value = toISO(new Date());
document.getElementById('reminder-date').value = toISO(new Date());

document.getElementById('income-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('income-message');
  const payload = {
    name: document.getElementById('income-name').value.trim(),
    amount: Number(document.getElementById('income-amount').value),
    date: document.getElementById('income-date').value,
    description: document.getElementById('income-description').value.trim()
  };
  await runWithLoadingState(event.submitter, 'Saving…', async () => {
    try {
      const created = await apiRequest('/api/income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      incomes.push(created);
      form.reset();
      document.getElementById('income-date').value = toISO(new Date());
      setFormMessage(message, 'success', 'Income recorded.');
      renderPlanning();
      notifyUser('success', 'Income recorded', `${created.name} was saved.`);
    } catch (error) {
      setFormMessage(message, 'error', error.message);
      notifyUser('error', 'Income could not be saved', error.message);
    }
  });
});

document.getElementById('recurring-income-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('recurring-income-message');
  const payload = {
    name: document.getElementById('recurring-income-name').value.trim(),
    amount: Number(document.getElementById('recurring-income-amount').value),
    day: Number(document.getElementById('recurring-income-day').value),
    description: document.getElementById('recurring-income-description').value.trim()
  };
  await runWithLoadingState(event.submitter, 'Scheduling…', async () => {
    try {
      const { generatedIncome, ...schedule } = await apiRequest('/api/recurring-income', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      recurringIncomeSchedules.push(schedule);
      if (generatedIncome && !incomes.some((income) => income.id === generatedIncome.id)) {
        incomes.push(generatedIncome);
      }
      form.reset();
      document.getElementById('recurring-income-day').value = '1';
      setFormMessage(message, 'success', 'Recurring income scheduled.');
      renderPlanning();
      notifyUser('success', 'Income scheduled', `${schedule.name} will repeat monthly.`);
    } catch (error) {
      setFormMessage(message, 'error', error.message);
      notifyUser('error', 'Income schedule failed', error.message);
    }
  });
});

document.getElementById('budget-rule-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('budget-rule-message');
  const payload = {
    period: document.getElementById('budget-rule-period').value,
    category: budgetRuleCategory.value,
    amount: Number(document.getElementById('budget-rule-amount').value)
  };
  await runWithLoadingState(event.submitter, 'Saving…', async () => {
    try {
      const saved = await apiRequest('/api/budgets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      budgetRules = [
        ...budgetRules.filter((budget) => budget.period !== saved.period || budget.category !== saved.category),
        saved
      ];
      form.reset();
      setFormMessage(message, 'success', 'Spending limit saved.');
      renderBudgetRules();
      notifyUser('success', 'Spending limit saved', `${saved.period} limit: ${formatCurrency(saved.amount)}.`);
    } catch (error) {
      setFormMessage(message, 'error', error.message);
      notifyUser('error', 'Spending limit failed', error.message);
    }
  });
});

document.getElementById('savings-goal-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('savings-goal-message');
  const payload = {
    name: document.getElementById('savings-goal-name').value.trim(),
    targetAmount: Number(document.getElementById('savings-goal-target').value),
    targetDate: document.getElementById('savings-goal-date').value
  };
  await runWithLoadingState(event.submitter, 'Creating…', async () => {
    try {
      const goal = await apiRequest('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      savingsGoals.push(goal);
      form.reset();
      setFormMessage(message, 'success', 'Savings goal created.');
      renderSavingsGoals();
      notifyUser('success', 'Savings goal created', `${goal.name} is ready to track.`);
    } catch (error) {
      setFormMessage(message, 'error', error.message);
      notifyUser('error', 'Goal could not be created', error.message);
    }
  });
});

document.getElementById('reminder-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.getElementById('reminder-message');
  const amountValue = document.getElementById('reminder-amount').value;
  const payload = {
    title: document.getElementById('reminder-title').value.trim(),
    date: document.getElementById('reminder-date').value,
    type: document.getElementById('reminder-type').value,
    amount: amountValue ? Number(amountValue) : null,
    description: document.getElementById('reminder-description').value.trim()
  };
  await runWithLoadingState(event.submitter, 'Adding…', async () => {
    try {
      const reminder = await apiRequest('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      financialReminders.push(reminder);
      reminderNoticeIds.delete(reminder.id);
      form.reset();
      document.getElementById('reminder-date').value = toISO(new Date());
      setFormMessage(message, 'success', 'Reminder added.');
      renderPlanning();
      notifyUser('success', 'Reminder added', `${reminder.title} is on your list.`);
    } catch (error) {
      setFormMessage(message, 'error', error.message);
      notifyUser('error', 'Reminder could not be added', error.message);
    }
  });
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
document.getElementById('analytics-range').addEventListener('change', renderAnalyticsTrend);
notificationButton.addEventListener('click', () => {
  const shouldShow = notificationPanel.hidden;
  notificationPanel.hidden = !shouldShow;
  notificationButton.setAttribute('aria-expanded', String(shouldShow));
});

dialogOpenButton.addEventListener('click', openExpenseDialog);
document.getElementById('sidebar-add-expense').addEventListener('click', openExpenseDialog);
document.getElementById('planning-view-all').addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('reminder-list').scrollIntoView({ behavior: 'smooth', block: 'center' });
});
document.getElementById('expense-table-search').addEventListener('input', () => {
  expenseTablePage = 1;
  renderExpenseTable();
});
document.getElementById('expense-table-filter').addEventListener('click', () => {
  appliedExpenseTableCategory = document.getElementById('expense-table-category').value;
  appliedExpenseTablePeriod = document.getElementById('expense-table-period').value;
  expenseTablePage = 1;
  renderExpenseTable();
});
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

document.getElementById('date-shortcut').addEventListener('click', () => {
  const calendarCard = document.querySelector('.calendar-card');
  renderCalendar();
  calendarCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const focusDate = calendarCard.querySelector('.calendar-day.is-selected')
    || calendarCard.querySelector('.calendar-day:not(.is-muted)');
  focusDate?.focus({ preventScroll: true });
});

window.addEventListener('hashchange', handleNavigation);
updateSettingsInputs();
handleNavigation();
function showPasswordUpdateForm() {
  showAuthScreen();
  document.getElementById('login-form').hidden = true;
  document.getElementById('register-form').hidden = true;
  document.getElementById('password-reset-form').hidden = true;
  document.getElementById('password-update-form').hidden = false;
  document.getElementById('forgot-password-button').hidden = true;
  document.getElementById('auth-mode-toggle').hidden = true;
  document.getElementById('auth-title').textContent = 'Choose a new password';
  document.getElementById('password-update-value').focus();
}

async function startSpendWise() {
  const authFragment = new URLSearchParams(window.location.hash.slice(1));
  const authQuery = new URLSearchParams(window.location.search);
  const authError = authFragment.get('error_description') || authFragment.get('error') ||
    authQuery.get('error_description') || authQuery.get('error');
  if (authError) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    showAuthScreen(authError);
    return;
  }
  const accessToken = authFragment.get('access_token');
  const refreshToken = authFragment.get('refresh_token');
  const authType = authFragment.get('type');
  if (accessToken && refreshToken) {
    window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.search}`);
    showAuthScreen();
    try {
      const result = await apiRequest('/api/auth/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          access_token: accessToken,
          refresh_token: refreshToken,
          type: authType
        })
      });
      if (result.passwordRecovery) {
        showPasswordUpdateForm();
        return;
      }
      if (result.mfaRequired) {
        await showMfaChallenge(result);
        return;
      }
      if (result.mfaOptional) {
        showOptionalMfaChoice();
        return;
      }
      await loadDashboardState();
    } catch (error) {
      showAuthScreen(error.message || 'That authentication link is invalid or expired.');
    }
    return;
  }

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
