export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Convert plain text into escaped HTML paragraphs. */
export function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map(
      (para) =>
        `<p style="margin:0 0 16px 0;line-height:1.6;">${esc(para.trim()).replace(/\n/g, '<br/>')}</p>`,
    )
    .join('');
}

export interface LayoutParams {
  locale: 'en' | 'ru';
  title: string;
  bodyHtml: string;
  ctaUrl?: string;
  ctaLabel?: string;
  unsubscribeUrl?: string;
}

const UNSUBSCRIBE_LABEL: Record<'en' | 'ru', string> = {
  en: 'Unsubscribe from these emails',
  ru: 'Отписаться от этих писем',
};

export function renderLayout(params: LayoutParams): string {
  const { locale, title, bodyHtml, ctaUrl, ctaLabel, unsubscribeUrl } = params;
  return `<!DOCTYPE html>
<html lang="${locale}">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background-color:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f7;padding:24px 0;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;">
        <tr><td style="padding:0 24px 16px 24px;">
          <span style="font-size:18px;font-weight:700;background:linear-gradient(90deg,#7c3aed,#9333ea);-webkit-background-clip:text;background-clip:text;color:#7c3aed;">INITE</span>
        </td></tr>
        <tr><td style="background-color:#ffffff;border-radius:12px;padding:32px 24px;">
          <h1 style="margin:0 0 16px 0;font-size:20px;line-height:1.4;color:#111827;">${esc(title)}</h1>
          ${bodyHtml}
          ${
            ctaUrl
              ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;"><tr><td style="border-radius:8px;background:linear-gradient(90deg,#7c3aed,#9333ea);">
                  <a href="${esc(ctaUrl)}" target="_blank" style="display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;">${esc(ctaLabel || (locale === 'ru' ? 'Открыть' : 'Open'))}</a>
                </td></tr></table>`
              : ''
          }
        </td></tr>
        <tr><td style="padding:16px 24px;font-size:12px;color:#9ca3af;">
          INITE Billing
          ${
            unsubscribeUrl
              ? ` · <a href="${esc(unsubscribeUrl)}" target="_blank" style="color:#9ca3af;text-decoration:underline;">${UNSUBSCRIBE_LABEL[locale]}</a>`
              : ''
          }
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
