/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ground: '#f3ece6',
        paper: '#fefaf2',
        ink: '#1f1f1f',
        muted: '#575757',
        field: '#b8312a',
        'on-field': '#fbeee6',
        'on-field-muted': '#f9e2d9',
        ok: '#2f6b3a',
        warn: '#8a5300',
      },
      fontFamily: {
        display: ['"Stack Sans Headline"', 'system-ui', 'sans-serif'],
        sans: ['"Stack Sans Text"', 'system-ui', 'sans-serif'],
      },
      borderColor: {
        line: 'rgba(31, 31, 31, 0.12)',
        'line-strong': 'rgba(31, 31, 31, 0.24)',
        'on-field-line': 'rgba(251, 238, 230, 0.28)',
      },
    },
  },
  plugins: [],
}
