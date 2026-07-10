import Aura from '@primeuix/themes/aura';
import { definePreset } from '@primeuix/themes';

// I token che in Aura vivono sotto colorScheme vanno ridefiniti sotto
// colorScheme.light E .dark, altrimenti l'override viene ignorato. Qui il
// valore è identico nei due scheme perché sono le CSS var del tema a
// commutare light/dark via @media (prefers-color-scheme).
const scheme = {
  primary: {
    color: 'var(--series)',
    contrastColor: 'var(--page)',
    hoverColor: 'var(--series)',
    activeColor: 'var(--series)',
  },
  content: {
    background: 'var(--surface)',
    hoverBackground: 'var(--wash)',
    borderColor: 'var(--hairline)',
    color: 'var(--ink)',
    hoverColor: 'var(--ink)',
  },
  text: {
    color: 'var(--ink)',
    hoverColor: 'var(--ink)',
    mutedColor: 'var(--muted)',
    hoverMutedColor: 'var(--ink-2)',
  },
  formField: {
    background: 'var(--surface)',
    borderColor: 'var(--hairline)',
    color: 'var(--ink)',
    hoverBorderColor: 'var(--series)',
    focusBorderColor: 'var(--series)',
    placeholderColor: 'var(--muted)',
  },
  overlay: {
    select: { background: 'var(--surface)', borderColor: 'var(--hairline)', color: 'var(--ink)' },
    popover: { background: 'var(--surface)', borderColor: 'var(--hairline)', color: 'var(--ink)' },
  },
  list: {
    option: {
      color: 'var(--ink)',
      focusBackground: 'var(--wash)',
      selectedBackground: 'var(--wash)',
      selectedColor: 'var(--ink)',
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
