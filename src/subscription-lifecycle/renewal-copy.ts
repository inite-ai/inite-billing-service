import { ReminderStep } from './renewal-reminders';

export type RenewalLocale = 'en' | 'ru' | 'pt' | 'es';

export function renewalLocale(locale: string | null | undefined): RenewalLocale {
  const base = String(locale ?? '')
    .toLowerCase()
    .split(/[-_]/)[0];
  return base === 'ru' || base === 'pt' || base === 'es' ? base : 'en';
}

interface Params {
  product: string;
  /** Already in the reader's format. */
  amount: string;
  periodEnd: Date;
  lastDay: Date;
  /** No wallet billing may charge: every payment is the buyer's own act. */
  buyerConfirms: boolean;
}
interface Copy {
  subject: string;
  body: string;
  ctaLabel: string;
}

const TAG: Record<RenewalLocale, string> = { en: 'en-US', ru: 'ru', pt: 'pt-BR', es: 'es' };

const day = (date: Date, locale: RenewalLocale) =>
  date
    .toLocaleDateString(TAG[locale], {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    })
    // Russian ends a date with an abbreviated "г.", which then meets the full stop.
    .replace(/\s*г\.$/, '\u00a0года');

/** The amount as the reader writes money. */
export function renewalAmount(amount: string, currency: string, locale: RenewalLocale): string {
  const value = Number(amount);
  return new Intl.NumberFormat(TAG[locale], {
    style: 'currency',
    currency,
    minimumFractionDigits: Number.isInteger(value) ? 0 : undefined,
    maximumFractionDigits: Number.isInteger(value) ? 0 : undefined,
  }).format(value);
}

const COPY: Record<
  RenewalLocale,
  { cta: string; how: string } & Record<
    ReminderStep,
    (p: Params, d: typeof day) => [string, string]
  >
> = {
  en: {
    cta: 'Pay for the next period',
    how: 'You confirm each payment yourself. Nothing is charged automatically.',
    lead: (p, d) => [
      `Renew your ${p.product} subscription`,
      `Your ${p.product} period ends on ${d(p.periodEnd, 'en')}. The next one costs ${p.amount}.`,
    ],
    due: (p, d) => [
      `Your ${p.product} period has ended`,
      `Pay ${p.amount} for the next period before ${d(p.lastDay, 'en')} to keep your access.`,
    ],
    mid: (p, d) => [
      `Your ${p.product} renewal is unpaid`,
      `Pay ${p.amount} for the next period before ${d(p.lastDay, 'en')} to keep your access.`,
    ],
    last: (p, d) => [
      `Your ${p.product} access ends soon`,
      `Access ends on ${d(p.lastDay, 'en')}. To keep it, pay ${p.amount} for the next period.`,
    ],
  },
  ru: {
    cta: 'Оплатить следующий период',
    how: 'Каждый платёж вы подтверждаете сами, автоматических списаний нет.',
    lead: (p, d) => [
      `Продлите подписку «${p.product}»`,
      `Оплаченный период «${p.product}» заканчивается ${d(p.periodEnd, 'ru')}. Следующий стоит ${p.amount}.`,
    ],
    due: (p, d) => [
      `Оплаченный период «${p.product}» закончился`,
      `Чтобы сохранить доступ, оплатите следующий период до ${d(p.lastDay, 'ru')}: ${p.amount}.`,
    ],
    mid: (p, d) => [
      `Продление «${p.product}» не оплачено`,
      `Чтобы сохранить доступ, оплатите следующий период до ${d(p.lastDay, 'ru')}: ${p.amount}.`,
    ],
    last: (p, d) => [
      `Доступ к «${p.product}» скоро закроется`,
      `Доступ закроется ${d(p.lastDay, 'ru')}. Чтобы его сохранить, оплатите следующий период: ${p.amount}.`,
    ],
  },
  pt: {
    cta: 'Pagar o próximo período',
    how: 'Cada pagamento só é feito com a sua confirmação.',
    lead: (p, d) => [
      `Renove sua assinatura ${p.product}`,
      `O período da sua assinatura ${p.product} termina em ${d(p.periodEnd, 'pt')}. O próximo custa ${p.amount}.`,
    ],
    due: (p, d) => [
      `O período da sua assinatura ${p.product} terminou`,
      `Para manter o acesso, pague ${p.amount} pelo próximo período antes de ${d(p.lastDay, 'pt')}.`,
    ],
    mid: (p, d) => [
      `A renovação da sua assinatura ${p.product} não foi paga`,
      `Para manter o acesso, pague ${p.amount} pelo próximo período antes de ${d(p.lastDay, 'pt')}.`,
    ],
    last: (p, d) => [
      `O acesso da sua assinatura ${p.product} termina em breve`,
      `O acesso termina em ${d(p.lastDay, 'pt')}. Para mantê-lo, pague ${p.amount} pelo próximo período.`,
    ],
  },
  es: {
    cta: 'Pagar el próximo período',
    how: 'Tú confirmas cada pago. No hay cobros automáticos.',
    lead: (p, d) => [
      `Renueva tu suscripción a ${p.product}`,
      `Tu período de ${p.product} termina el ${d(p.periodEnd, 'es')}. El siguiente cuesta ${p.amount}.`,
    ],
    due: (p, d) => [
      `Tu período de ${p.product} ha terminado`,
      `Para conservar el acceso, paga ${p.amount} por el próximo período antes del ${d(p.lastDay, 'es')}.`,
    ],
    mid: (p, d) => [
      `La renovación de ${p.product} no está pagada`,
      `Para conservar el acceso, paga ${p.amount} por el próximo período antes del ${d(p.lastDay, 'es')}.`,
    ],
    last: (p, d) => [
      `Tu acceso a ${p.product} termina pronto`,
      `El acceso termina el ${d(p.lastDay, 'es')}. Para conservarlo, paga ${p.amount} por el próximo período.`,
    ],
  },
};

/** A renewal letter: what is owed, until when, and, where it is so, that the buyer confirms it. */
export function renewalCopy(step: ReminderStep, locale: RenewalLocale, params: Params): Copy {
  const words = COPY[locale];
  const [subject, body] = words[step](params, day);
  return {
    subject,
    body: params.buyerConfirms ? `${body}\n\n${words.how}` : body,
    ctaLabel: words.cta,
  };
}
