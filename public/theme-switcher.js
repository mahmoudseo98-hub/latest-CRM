/* theme-switcher.js — Global dark/light mode switcher */
(function () {
  const THEME_KEY = 'seo-ui-theme';
  const SYSTEM_PREFERS_DARK = window.matchMedia('(prefers-color-scheme: dark)').matches;

  function getStoredTheme() {
    try {
      return localStorage.getItem(THEME_KEY);
    } catch (_) {
      return null;
    }
  }

  function setStoredTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
  }

  function getInitialTheme() {
    const stored = getStoredTheme();
    if (stored === 'dark' || stored === 'light') return stored;
    return SYSTEM_PREFERS_DARK ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.classList.toggle('theme-dark', isDark);
    document.documentElement.setAttribute('data-theme', theme);
    setStoredTheme(theme);
    updateThemeSwitchers(isDark);
  }

  function updateThemeSwitchers(isDark) {
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.textContent = isDark ? '☀️' : '🌙';
      btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
    });
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') || getInitialTheme();
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
  }

  function init() {
    const theme = getInitialTheme();
    applyTheme(theme);

    document.addEventListener('click', (e) => {
      if (e.target.hasAttribute('data-theme-toggle')) {
        e.preventDefault();
        e.stopPropagation();
        toggleTheme();
      }
    });
  }

  window.themeSwitcher = {
    init,
    getTheme: () => document.documentElement.getAttribute('data-theme') || getInitialTheme(),
    setTheme: applyTheme,
    toggle: toggleTheme,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
