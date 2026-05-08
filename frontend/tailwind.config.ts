import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        panel: 'var(--panel)',
        'panel-2': 'var(--panel-2)',
        'panel-3': 'var(--panel-3)',
        hover: 'var(--hover)',
        line: 'var(--line)',
        'line-strong': 'var(--line-strong)',
        text: 'var(--text)',
        'text-2': 'var(--text-2)',
        'text-3': 'var(--text-3)',
        'text-4': 'var(--text-4)',
        accent: 'var(--accent)',
        'accent-2': 'var(--accent-2)',
        'accent-soft': 'var(--accent-soft)',
        danger: 'var(--danger)',
      },
      fontFamily: {
        sans: ['Geist', '-apple-system', 'BlinkMacSystemFont', '"Helvetica Neue"', 'Arial', 'sans-serif'],
        mono: ['"Geist Mono"', 'ui-monospace', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        DEFAULT: 'var(--radius)',
        lg: 'var(--radius-lg)',
      },
      boxShadow: {
        '1': 'var(--shadow-1)',
        '2': 'var(--shadow-2)',
      },
    },
  },
  plugins: [],
};

export default config;
