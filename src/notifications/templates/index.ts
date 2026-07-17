import { renderLayout, textToHtml } from './layout';

export type TemplateLocale = 'en' | 'ru';

export interface TemplateParams {
  productName?: string;
  serviceName?: string;
  amount?: string;
  currency?: string;
  daysOverdue?: number;
  periodEnd?: string;
  featureName?: string;
  usagePct?: number;
  ctaUrl?: string;
  ctaLabel?: string;
  unsubscribeUrl?: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

type TemplateFn = (
  locale: TemplateLocale,
  params: TemplateParams,
) => {
  subject: string;
  body: string;
  ctaLabel: string;
};

const product = (p: TemplateParams, locale: TemplateLocale) =>
  p.productName || (locale === 'ru' ? 'ваш продукт' : 'your product');

const templates: Record<string, TemplateFn> = {
  abandoned_checkout: (locale, p) =>
    locale === 'ru'
      ? {
          subject: 'Вы не завершили оформление заказа',
          body: `Вы начали оформление «${product(p, locale)}», но не завершили оплату.\n\nЗаказ сохранён — вернуться к оплате можно в один клик.`,
          ctaLabel: 'Завершить оплату',
        }
      : {
          subject: 'You left your checkout unfinished',
          body: `You started checking out "${product(p, locale)}" but didn't complete the payment.\n\nYour order is saved — you can pick up right where you left off.`,
          ctaLabel: 'Complete payment',
        },

  dunning: (locale, p) =>
    locale === 'ru'
      ? {
          subject: 'Проблема с оплатой подписки',
          body: `Не удалось списать оплату за подписку «${product(p, locale)}»${
            p.daysOverdue ? ` (просрочка ${p.daysOverdue} дн.)` : ''
          }.\n\nЧтобы сохранить доступ, обновите способ оплаты или повторите платёж.`,
          ctaLabel: 'Обновить оплату',
        }
      : {
          subject: 'Payment issue with your subscription',
          body: `We couldn't process the payment for your "${product(p, locale)}" subscription${
            p.daysOverdue ? ` (${p.daysOverdue} day(s) overdue)` : ''
          }.\n\nTo keep your access, please update your payment method or retry the payment.`,
          ctaLabel: 'Update payment',
        },

  winback: (locale, p) =>
    locale === 'ru'
      ? {
          subject: 'Нам будет вас не хватать',
          body: `Ваша подписка «${product(p, locale)}» скоро завершится${
            p.periodEnd ? ` (${p.periodEnd})` : ''
          }.\n\nЕсли передумаете — возобновить её можно в пару кликов, весь прогресс сохранится.`,
          ctaLabel: 'Возобновить подписку',
        }
      : {
          subject: "We'd love to keep you",
          body: `Your "${product(p, locale)}" subscription is ending soon${
            p.periodEnd ? ` (${p.periodEnd})` : ''
          }.\n\nIf you change your mind, you can resume it in a couple of clicks — everything will be right where you left it.`,
          ctaLabel: 'Resume subscription',
        },

  trial_ending: (locale, p) =>
    locale === 'ru'
      ? {
          subject: 'Пробный период скоро закончится',
          body: `Пробный период «${product(p, locale)}» завершится${
            p.periodEnd ? ` ${p.periodEnd}` : ' в ближайшие дни'
          }.\n\nЧтобы не потерять доступ, оформите подписку заранее.`,
          ctaLabel: 'Управлять подпиской',
        }
      : {
          subject: 'Your trial ends soon',
          body: `Your "${product(p, locale)}" trial ends${
            p.periodEnd ? ` on ${p.periodEnd}` : ' in the next few days'
          }.\n\nSubscribe now so you don't lose access.`,
          ctaLabel: 'Manage subscription',
        },

  quota_warning: (locale, p) =>
    locale === 'ru'
      ? {
          subject: 'Вы приближаетесь к лимиту использования',
          body: `Использование «${p.featureName || product(p, locale)}» достигло ${
            p.usagePct ?? 80
          }% лимита за период.\n\nПри достижении 100% операции будут приостановлены до сброса лимита.`,
          ctaLabel: 'Посмотреть использование',
        }
      : {
          subject: "You're approaching your usage limit",
          body: `Your usage of "${p.featureName || product(p, locale)}" has reached ${
            p.usagePct ?? 80
          }% of the limit for this period.\n\nOnce you hit 100%, further operations will be paused until the limit resets.`,
          ctaLabel: 'View usage',
        },
};

export function isKnownTemplate(type: string): boolean {
  return type in templates;
}

/** Render a category template into a full email (LLM-free fallback path). */
export function renderTemplate(
  type: string,
  locale: TemplateLocale,
  params: TemplateParams,
): RenderedEmail {
  const fn = templates[type];
  if (!fn) {
    throw new Error(`Unknown notification template: ${type}`);
  }
  const { subject, body, ctaLabel } = fn(locale, params);
  return {
    subject,
    text: body,
    html: renderLayout({
      locale,
      title: subject,
      bodyHtml: textToHtml(body),
      ctaUrl: params.ctaUrl,
      ctaLabel: params.ctaLabel || ctaLabel,
      unsubscribeUrl: params.unsubscribeUrl,
    }),
  };
}

/** Wrap LLM-generated plain text (subject+body) into the branded layout. */
export function wrapLlmBody(
  subject: string,
  bodyText: string,
  locale: TemplateLocale,
  params: TemplateParams,
): RenderedEmail {
  return {
    subject,
    text: bodyText,
    html: renderLayout({
      locale,
      title: subject,
      bodyHtml: textToHtml(bodyText),
      ctaUrl: params.ctaUrl,
      ctaLabel: params.ctaLabel,
      unsubscribeUrl: params.unsubscribeUrl,
    }),
  };
}
