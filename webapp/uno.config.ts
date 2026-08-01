import {
  defineConfig,
  presetAttributify,
  presetIcons,
  presetUno,
} from 'unocss'

export default defineConfig({
  shortcuts: [
    { logo: 'i-logos-react w-6em h-6em transform transition-800 hover:rotate-180' },
    {
      'btn-primary': 'inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-white bg-indigo-600 shadow-lg shadow-indigo-950/40 transition-colors duration-200 hover:bg-indigo-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 disabled:pointer-events-none disabled:bg-slate-600 disabled:shadow-none',
      'panel': 'bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl',
      'input-dark': 'bg-white/10 border border-white/15 rounded-xl px-4 py-2.5 text-white placeholder-slate-400 transition-colors focus:outline-none focus:border-indigo-400 focus:bg-white/15',
      'icon-btn': 'relative inline-grid place-items-center w-10 h-10 rounded-xl text-slate-200 bg-white/5 border border-white/10 transition-colors duration-200 hover:bg-white/15 disabled:opacity-40 disabled:pointer-events-none',
      'chip': 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-black/50 backdrop-blur text-xs font-medium text-white',
    }
  ],
  presets: [
    presetUno(),
    presetAttributify(),
    presetIcons({
      extraProperties: {
        'display': 'inline-block',
        'vertical-align': 'middle'
      }
    })
  ]
})
