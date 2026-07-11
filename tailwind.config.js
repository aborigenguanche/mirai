/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink:    { DEFAULT:'#040B16', soft:'#0A1830' },
        navy:   { DEFAULT:'#0C1F3D', light:'#15294A' },
        pulse:  { DEFAULT:'#00E5C7', dim:'#00B89F', bg:'#E8FFFB' },
        sky: {
          50:'#F0F9FF', 100:'#E0F2FE', 200:'#BAE6FD',
          300:'#7DD3FC', 400:'#38BDF8', 500:'#0EA5E9',
          600:'#0284C7', 700:'#0369A1',
        },
        surface: '#F7FAFE',
        border:  '#E4E9F2',
      },
      fontFamily: {
        display: ['Space Grotesk', 'sans-serif'],
        body:    ['DM Sans', 'sans-serif'],
        mono:    ['JetBrains Mono', 'monospace'],
      },
      borderRadius: {
        sm:'8px', md:'12px', lg:'16px', xl:'24px', '2xl':'32px',
      },
      boxShadow: {
        sm:   '0 1px 4px rgba(4,11,22,.06)',
        md:   '0 4px 20px rgba(14,165,233,.1), 0 2px 8px rgba(4,11,22,.07)',
        lg:   '0 12px 44px rgba(14,165,233,.14), 0 4px 16px rgba(4,11,22,.08)',
        xl:   '0 24px 70px rgba(7,20,40,.22), 0 8px 24px rgba(14,165,233,.14)',
        glow: '0 0 0 1px rgba(0,229,199,.25), 0 8px 30px rgba(0,229,199,.22)',
      },
      animation: {
        'pulse-dot':  'pulseDot 1.8s infinite',
        'ecg-scroll': 'ecgScroll 11s linear infinite',
        'slide-down': 'slideDown .3s ease',
        'fade-in':    'fadeIn .2s ease',
        'toast-in':   'toastIn .3s ease forwards',
        'spin':       'spin .7s linear infinite',
      },
      keyframes: {
        pulseDot:   { '0%,100%':{ boxShadow:'0 0 0 0 rgba(0,229,199,.55)' }, '50%':{ boxShadow:'0 0 0 6px rgba(0,229,199,0)' } },
        ecgScroll:  { from:{ transform:'translateX(0)' },   to:{ transform:'translateX(-50%)' } },
        slideDown:  { from:{ opacity:'0', transform:'translateY(-8px)' }, to:{ opacity:'1', transform:'translateY(0)' } },
        fadeIn:     { from:{ opacity:'0' }, to:{ opacity:'1' } },
        toastIn:    { from:{ transform:'translateX(20px)', opacity:'0' }, to:{ transform:'translateX(0)', opacity:'1' } },
        spin:       { to:{ transform:'rotate(360deg)' } },
      },
    },
  },
  plugins: [],
};
