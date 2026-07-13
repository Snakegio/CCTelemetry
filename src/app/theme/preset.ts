import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';

// I token che in Aura vivono sotto colorScheme vanno ridefiniti sotto
// colorScheme.light E .dark, altrimenti l'override viene ignorato. Qui il
// valore è identico nei due scheme perché sono le CSS var del tema a
// commutare light/dark via @media (prefers-color-scheme).
const scheme = {
  primary: {
    color: 'var(--color-accent)',
    contrastColor: 'var(--color-bg)',
    hoverColor: 'var(--color-accent)',
    activeColor: 'var(--color-accent)',
  },
  content: {
    background: 'var(--color-surface)',
    hoverBackground: 'var(--wash)',
    borderColor: 'var(--color-divider)',
    color: 'var(--color-text)',
    hoverColor: 'var(--color-text)',
  },
  text: {
    color: 'var(--color-text)',
    hoverColor: 'var(--color-text)',
    mutedColor: 'var(--muted)',
    hoverMutedColor: 'var(--ink-2)',
  },
  formField: {
    background: 'var(--color-surface)',
    borderColor: 'var(--color-divider)',
    color: 'var(--color-text)',
    hoverBorderColor: 'var(--color-accent)',
    focusBorderColor: 'var(--color-accent)',
    placeholderColor: 'var(--muted)',
  },
  overlay: {
    select: { background: 'var(--color-surface)', borderColor: 'var(--color-divider)', color: 'var(--color-text)' },
    popover: { background: 'var(--color-surface)', borderColor: 'var(--color-divider)', color: 'var(--color-text)' },
  },
  list: {
    option: {
      color: 'var(--color-text)',
      focusBackground: 'var(--wash)',
      selectedBackground: 'var(--wash)',
      selectedColor: 'var(--color-text)',
    },
  },
};

export const AppPreset = definePreset(Aura, {
  semantic: {
    // radius coerente con i rounded-[10px] diffusi nei template
    borderRadius: { md: '10px', lg: '10px' },
    colorScheme: { light: scheme, dark: scheme },
  },
});
