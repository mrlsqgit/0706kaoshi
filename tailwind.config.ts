import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#e8fafa',
          100: '#b5e8e8',
          200: '#82d6d6',
          300: '#4fc4c4',
          400: '#1cb2b2',
          500: '#0fc6c2',
          600: '#0bada9',
          700: '#089490',
          800: '#067c78',
          900: '#0b6e6e',
        },
        warning: {
          50: '#fff7e8',
          100: '#ffe4ba',
          200: '#ffd18c',
          300: '#ffbe5e',
          400: '#ffab30',
          500: '#d97b00',
        },
        danger: '#cf1322',
      },
      borderRadius: {
        card: '12px',
      },
    },
  },
  plugins: [],
};

export default config;
