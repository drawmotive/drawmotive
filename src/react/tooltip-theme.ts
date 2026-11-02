import { Kbd, Tooltip, type MantineThemeOverride } from '@mantine/core';

/** Pin Mantine's default tooltip colors to this provider; a foreign dark ancestor must not override a light editor. */
export function tooltipTheme(dark: boolean): MantineThemeOverride {
  const tooltip={backgroundColor:'var(--mantine-color-gray-'+(dark?'2':'9')+')',color:'var(--mantine-color-'+(dark?'black':'white')+')'};
  return {components:{
    Tooltip:Tooltip.extend({styles:{tooltip}}),
    TooltipFloating:Tooltip.Floating.extend({styles:{tooltip}}),
    Kbd:Kbd.extend({styles:{root:{
      borderColor:'var(--mantine-color-'+(dark?'dark-4':'gray-3')+')',
      color:'var(--mantine-color-'+(dark?'dark-0':'gray-7')+')',
      backgroundColor:'var(--mantine-color-'+(dark?'dark-6':'gray-0')+')',
    }}}),
  }};
}
