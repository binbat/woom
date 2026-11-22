import { defineConfig, presetAttributify, presetIcons, presetUno } from 'unocss'

export default defineConfig({
  theme: {
    colors: {
      panel: 'var(--color-panel)',
      surface: 'var(--color-surface)',
      control: 'var(--color-control)',
      'control-hover': 'var(--color-control-hover)',
      line: 'var(--color-line)',
      heading: 'var(--color-heading)',
      foreground: 'var(--color-foreground)',
      muted: 'var(--color-muted)',
      subtle: 'var(--color-subtle)',
      disabled: 'var(--color-disabled)',
      accent: 'var(--color-accent)',
      danger: 'var(--color-danger)',
      success: 'var(--color-success)',
      warning: 'var(--color-warning)',
    },
  },
  shortcuts: [
    {
      logo: 'i-logos-react w-6em h-6em transform transition-800 hover:rotate-180',
    },
    {
      'btn-primary':
        'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white bg-indigo-600 shadow-lg shadow-indigo-950/40 transition-colors duration-200 hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:pointer-events-none disabled:bg-slate-600 disabled:shadow-none',
      panel:
        'bg-panel backdrop-blur-md border border-line rounded-2xl shadow-2xl',
      'input-control':
        'bg-control border border-line rounded-xl px-4 py-2.5 text-foreground placeholder-subtle transition-colors focus:outline-none focus:border-indigo-400 focus:bg-control-hover',
      'icon-btn':
        'relative inline-grid place-items-center w-9 h-9 md:w-10 md:h-10 rounded-xl text-foreground bg-control border border-line transition-colors duration-200 hover:bg-control-hover disabled:opacity-40 disabled:pointer-events-none',
      'control-group':
        'flex items-center gap-0.5 md:gap-1 rounded-xl bg-control border border-line px-1 md:px-1.5 py-1',
      chip: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur text-xs font-medium text-white',
    },
  ],
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      extraProperties: {
        display: 'inline-block',
        'vertical-align': 'middle',
      },
    }),
  ],
})
