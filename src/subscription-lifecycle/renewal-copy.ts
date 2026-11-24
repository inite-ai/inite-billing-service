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
  amount: string;
  periodEnd: Date;
  lastDay: Date;
}
interface Copy {
  subject: string;
  body: string;
  ctaLabel: string;
}

const day = (date: Date, locale: RenewalLocale) =>
  date.toLocaleDateString(locale === 'pt' ? 'pt-BR' : locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

const COPY: Record<
  RenewalLocale,
  { cta: string; how: string } & Record<
    ReminderStep,
    (p: Params, d: typeof day) => [string, string]
  >
> = {
  en: {
    cta: 'Pay for the next period',
    how: 'You confirm each payment yourself: nothing is charged without you.',
    lead: (p, d) => [
      `Renew your ${p.product} subscription`,
      `Your ${p.product} period ends on ${d(p.periodEnd, 'en')}. The next one costs ${p.amount}.`,
    ],
    due: (p, d) => [
      `Your ${p.product} period has ended`,
      `The next period costs ${p.amount}. You keep access until ${d(p.lastDay, 'en')}.`,
    ],
    mid: (p, d) => [
      `${p.product} is waiting for your payment`,
      `The renewal of ${p.amount} is not paid yet. You keep access until ${d(p.lastDay, 'en')}.`,
    ],
    last: (p, d) => [
      `Last day of ${p.product}`,
      `Access ends on ${d(p.lastDay, 'en')} unless the renewal of ${p.amount} is paid.`,
    ],
  },
  ru: {
    cta: 'Оплатить следующий период',
    how: 'Каждый платёж подтверждаете вы: без вас ничего не спишется.',
    lead: (p, d) => [
      `Продлите подписку «${p.product}»`,
      `Оплаченный период «${p.product}» заканчивается ${d(p.periodEnd, 'ru')}. Следующий стоит ${p.amount}.`,
    ],
    due: (p, d) => [
      `Период «${p.product}» закончился`,
      `Следующий период стоит ${p.amount}. Доступ сохраняется до ${d(p.lastDay, 'ru')}.`,
    ],
    mid: (p, d) => [
      `«${p.product}» ждёт оплаты`,
      `Продление на ${p.amount} пока не оплачено. Доступ сохраняется до ${d(p.lastDay, 'ru')}.`,
    ],
    last: (p, d) => [
      `Последний день «${p.product}»`,
      `Доступ закроется ${d(p.lastDay, 'ru')}, если продление на ${p.amount} не оплатить.`,
    ],
  },
  pt: {
    cta: 'Pagar o próximo período',
    how: 'Você confirma cada pagamento: nada é cobrado sem você.',
    lead: (p, d) => [
      `Renove sua assinatura ${p.product}`,
      `Seu período de ${p.product} termina em ${d(p.periodEnd, 'pt')}. O próximo custa ${p.amount}.`,
    ],
    due: (p, d) => [
      `Seu período de ${p.product} terminou`,
      `O próximo período custa ${p.amount}. Seu acesso continua até ${d(p.lastDay, 'pt')}.`,
    ],
    mid: (p, d) => [
      `${p.product} aguarda seu pagamento`,
      `A renovação de ${p.amount} ainda não foi paga. Seu acesso continua até ${d(p.lastDay, 'pt')}.`,
    ],
    last: (p, d) => [
      `Último dia de ${p.product}`,
      `O acesso termina em ${d(p.lastDay, 'pt')} se a renovação de ${p.amount} não for paga.`,
    ],
  },
  es: {
    cta: 'Pagar el próximo período',
    how: 'Tú confirmas cada pago: no se cobra nada sin ti.',
    lead: (p, d) => [
      `Renueva tu suscripción a ${p.product}`,
      `Tu período de ${p.product} termina el ${d(p.periodEnd, 'es')}. El siguiente cuesta ${p.amount}.`,
    ],
    due: (p, d) => [
      `Tu período de ${p.product} terminó`,
      `El próximo período cuesta ${p.amount}. Conservas el acceso hasta el ${d(p.lastDay, 'es')}.`,
    ],
    mid: (p, d) => [
      `${p.product} espera tu pago`,
      `La renovación de ${p.amount} aún no está pagada. Conservas el acceso hasta el ${d(p.lastDay, 'es')}.`,
    ],
    last: (p, d) => [
      `Último día de ${p.product}`,
      `El acceso termina el ${d(p.lastDay, 'es')} si no se paga la renovación de ${p.amount}.`,
    ],
  },
};

/** A renewal letter: what is owed, until when, and that the buyer confirms it. */
export function renewalCopy(step: ReminderStep, locale: RenewalLocale, params: Params): Copy {
  const words = COPY[locale];
  const [subject, body] = words[step](params, day);
  return { subject, body: `${body}\n\n${words.how}`, ctaLabel: words.cta };
}
