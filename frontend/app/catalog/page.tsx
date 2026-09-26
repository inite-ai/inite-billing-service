'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import { getErrorMessage } from '@/lib/api-error';
import { useAuth } from '@/contexts/AuthContext';
import { LedgerShell } from '@/components/ledger/LedgerShell';
import { ClientLayout } from '@/components/layout/ClientLayout';
import { PlanCard } from '@/components/catalog/PlanCard';
import { OneOffCard } from '@/components/catalog/OneOffCard';
import type { Price, Product } from '@/lib/types';
import {
  currenciesOf,
  guessCurrency,
  isAddon,
  priceFor,
  resolveCurrency,
  sortAmount,
  yearlySaving,
  type Interval,
  type StorefrontService,
} from '@/lib/catalog';

const CURRENCY_KEY = 'billing.catalog.currency';
const ALL = 'all';

/** Statuses that make a plan the customer's own. */
const OWNED = ['active', 'trialing', 'past_due'];

const PLAN_COLUMNS: Record<number, string> = {
  1: 'lg:grid-cols-1 lg:max-w-md',
  2: 'lg:grid-cols-2 lg:max-w-4xl',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
};

function readStoredCurrency(): string | null {
  try {
    return localStorage.getItem(CURRENCY_KEY);
  } catch {
    return null;
  }
}

function storeCurrency(value: string) {
  try {
    localStorage.setItem(CURRENCY_KEY, value);
  } catch {
    // Private mode or blocked storage: the choice just is not remembered.
  }
}

/**
 * The public price list of every INITE product, straight from billing.
 *
 * Anyone can look; signing in is asked for only on "buy", and the purchase
 * resumes after it (`?buy=<price code>`). Prices are shown in one currency at
 * a time — guessed from the language and region, switchable, remembered — so
 * a plan sold in dollars, reais and roubles reads as one price, not three.
 */
function CatalogContent() {
  const t = useTranslations('catalog');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const params = useSearchParams();
  const { user, isLoading: authLoading } = useAuth();

  const [services, setServices] = useState<StorefrontService[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [owned, setOwned] = useState<Set<string>>(new Set());
  const [chosenCurrency, setChosenCurrency] = useState<string | null>(null);
  const [interval, setBillingInterval] = useState<Interval>('month');
  const [busy, setBusy] = useState<string | null>(null);
  const resumed = useRef(false);

  const serviceCode = params.get('service') ?? ALL;

  const load = useCallback(async () => {
    setFailed(false);
    setServices(null);
    try {
      const res = await api.get('/v1/products/storefront');
      setServices(res.data.services ?? []);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // The customer's own plans, to mark them rather than sell them again.
  useEffect(() => {
    if (!user) return;
    api
      .get('/v1/subscriptions/me')
      .then((res) => {
        const codes = (res.data as { productCode: string | null; status: string }[])
          .filter((s) => s.productCode && OWNED.includes(s.status))
          .map((s) => s.productCode as string);
        setOwned(new Set(codes));
      })
      .catch(() => setOwned(new Set()));
  }, [user]);

  const visible = useMemo(() => {
    if (!services) return [];
    return serviceCode === ALL ? services : services.filter((s) => s.code === serviceCode);
  }, [services, serviceCode]);

  const visibleProducts = useMemo(() => visible.flatMap((s) => s.products), [visible]);
  const currencies = useMemo(() => currenciesOf(visibleProducts), [visibleProducts]);

  const currency = useMemo(() => {
    const browser = typeof navigator !== 'undefined' ? navigator.language : undefined;
    return resolveCurrency(
      currencies,
      chosenCurrency,
      readStoredCurrency(),
      guessCurrency(locale, browser),
    );
  }, [currencies, chosenCurrency, locale]);

  const plans = visibleProducts.filter((p) => p.type === 'subscription');
  const hasYearly = plans.some(
    (p) => priceFor(p, currency, 'year') && priceFor(p, currency, 'month'),
  );
  const bestSaving = hasYearly ? Math.max(0, ...plans.map((p) => yearlySaving(p, currency))) : 0;

  const setService = (code: string) => {
    const next = new URLSearchParams(params.toString());
    if (code === ALL) next.delete('service');
    else next.set('service', code);
    const query = next.toString();
    router.replace(query ? `/catalog?${query}` : '/catalog', { scroll: false });
  };

  const pickCurrency = (value: string) => {
    setChosenCurrency(value);
    storeCurrency(value);
  };

  const startCheckout = useCallback(
    async (product: Product, price: Price) => {
      setBusy(price.id);
      try {
        const subscription = product.type === 'subscription';
        const res = await api.post('/v1/checkout/sessions', {
          priceCode: price.code,
          mode: subscription ? 'SUBSCRIPTION' : 'PAYMENT',
          successUrl: `${window.location.origin}${subscription ? '/subscriptions' : '/orders'}`,
          errorUrl: `${window.location.origin}/catalog`,
        });
        router.push(`/checkout/${res.data.sessionId}`);
      } catch (e) {
        toast.error(getErrorMessage(e, tc('errors.generic')));
        setBusy(null);
      }
    },
    [router, tc],
  );

  const buy = (product: Product, price: Price) => {
    if (user) {
      void startCheckout(product, price);
      return;
    }
    // Sign in first, then come back here and carry on with this price.
    const back = new URLSearchParams();
    if (serviceCode !== ALL) back.set('service', serviceCode);
    back.set('buy', price.code);
    router.push(`/login?returnTo=${encodeURIComponent(`/catalog?${back.toString()}`)}`);
  };

  // Back from signing in with a purchase to finish.
  useEffect(() => {
    const code = params.get('buy');
    if (!code || !services || authLoading || !user || resumed.current) return;
    resumed.current = true;
    for (const s of services) {
      for (const p of s.products) {
        const price = p.prices?.find((pr) => pr.code === code);
        if (price) {
          void startCheckout(p, price);
          return;
        }
      }
    }
  }, [params, services, user, authLoading, startCheckout]);

  const nav = authLoading ? null : user ? (
    <Link href="/dashboard" className="btn ghost">
      {t('account')}
    </Link>
  ) : (
    <Link href="/login?returnTo=%2Fcatalog" className="btn ghost">
      {t('signIn')}
    </Link>
  );

  // Signed in, the catalog is a page of the cabinet, with its navigation;
  // for a visitor it is a public page of the site.
  const embedded = !!user;

  const body = (
    <div className="wrap">
      {embedded ? (
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
            {t('title')}
          </h1>
          <p className="mt-1 text-sm text-slate-500">{t('lead')}</p>
        </header>
      ) : (
        <header className="rise d1 pb-8 pt-14 sm:pt-20">
          <p className="eyebrow mb-5">
            <span className="dot">●</span> {t('eyebrow')}
          </p>
          <h1 className="max-w-[16ch] text-[40px] sm:text-[60px]">{t('headline')}</h1>
          <p className="mt-5 max-w-[46ch] text-[17px] leading-relaxed text-[color:var(--dim)]">
            {t('lead')}
          </p>
        </header>
      )}

      {services && services.length > 1 && (
        <div className="svc-tabs mb-4" role="group" aria-label={t('allProducts')}>
          <button type="button" aria-pressed={serviceCode === ALL} onClick={() => setService(ALL)}>
            {t('allProducts')}
          </button>
          {services.map((s) => (
            <button
              key={s.code}
              type="button"
              aria-pressed={serviceCode === s.code}
              onClick={() => setService(s.code)}
            >
              {s.name}
              <span>{s.products.length}</span>
            </button>
          ))}
        </div>
      )}

      {services && visibleProducts.length > 0 && (
        <div className="mb-10 flex flex-wrap items-center gap-3 border-b border-[color:var(--line)] pb-6">
          {hasYearly && (
            <div className="seg" role="group" aria-label={t('intervalYear')}>
              <button
                type="button"
                aria-pressed={interval === 'month'}
                onClick={() => setBillingInterval('month')}
              >
                {t('intervalMonth')}
              </button>
              <button
                type="button"
                aria-pressed={interval === 'year'}
                onClick={() => setBillingInterval('year')}
              >
                {t('intervalYear')}
                {bestSaving > 0 && <em>−{bestSaving}%</em>}
              </button>
            </div>
          )}
          {currencies.length > 1 && (
            <div className="seg sm:ml-auto" role="group" aria-label={t('currency')}>
              {currencies.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={currency === c}
                  onClick={() => pickCurrency(c)}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {failed ? (
        <div className="panel mx-auto max-w-md p-9 text-center" role="alert">
          <h2 className="mb-5 text-[26px]">{t('errorTitle')}</h2>
          <button type="button" onClick={() => void load()} className="btn ghost">
            <RefreshCw className="h-4 w-4" />
            {t('retry')}
          </button>
        </div>
      ) : !services ? (
        <div
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-busy="true"
          aria-label={tc('loading')}
        >
          {[0, 1, 2].map((i) => (
            <div key={i} className="skel h-[420px]" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <p className="panel mx-auto max-w-md p-9 text-center text-[color:var(--dim)]">
          {t('noProducts')}
        </p>
      ) : (
        <div className="space-y-20">
          {visible.map((service, index) => (
            <ServiceSection
              key={service.id}
              index={index}
              service={service}
              showHeading={visible.length > 1 || (services?.length ?? 0) > 1}
              currency={currency}
              interval={interval}
              owned={owned}
              busy={busy}
              onBuy={buy}
            />
          ))}
        </div>
      )}
    </div>
  );

  // Until the session is known, nothing: a signed-in customer would
  // otherwise see the public frame flash before the cabinet.
  if (authLoading) return <div className="lp" />;

  if (embedded) {
    return (
      <ClientLayout>
        <div className="lp lp-embed">{body}</div>
      </ClientLayout>
    );
  }

  return (
    <LedgerShell wide nav={nav}>
      {body}
    </LedgerShell>
  );
}

function ServiceSection({
  service,
  index,
  showHeading,
  currency,
  interval,
  owned,
  busy,
  onBuy,
}: {
  service: StorefrontService;
  index: number;
  showHeading: boolean;
  currency: string;
  interval: Interval;
  owned: Set<string>;
  busy: string | null;
  onBuy: (product: Product, price: Price) => void;
}) {
  const t = useTranslations('catalog');
  const byPrice = (a: Product, b: Product) => sortAmount(a, currency) - sortAmount(b, currency);
  const plans = service.products
    .filter((p) => p.type === 'subscription' && !isAddon(p))
    .sort(byPrice);
  const addons = service.products
    .filter((p) => p.type === 'subscription' && isAddon(p))
    .sort(byPrice);
  const oneOff = service.products.filter((p) => p.type !== 'subscription').sort(byPrice);
  const groups = [plans, addons, oneOff].filter((g) => g.length > 0).length;
  const busyIn = (p: Product) => !!busy && !!p.prices?.some((pr) => pr.id === busy);

  return (
    <section aria-labelledby={`svc-${service.code}`}>
      {showHeading && (
        <div className="sechead !mb-8">
          <span className="secnum">{String(index + 1).padStart(2, '0')}</span>
          <h2 id={`svc-${service.code}`}>{service.name}</h2>
          <span className="hint mono !text-[12px]">
            {t('productsCount', { count: service.products.length })}
          </span>
        </div>
      )}

      <div className="space-y-12">
        {plans.length > 0 && (
          <div>
            {groups > 1 && <p className="eyebrow mb-5">{t('plans')}</p>}
            <div
              className={`grid gap-4 pt-3 sm:grid-cols-2 ${PLAN_COLUMNS[Math.min(plans.length, 4)]}`}
            >
              {plans.map((p) => (
                <PlanCard
                  key={p.id}
                  product={p}
                  currency={currency}
                  interval={interval}
                  mine={owned.has(p.code)}
                  busy={busyIn(p)}
                  onBuy={onBuy}
                />
              ))}
            </div>
          </div>
        )}

        {addons.length > 0 && (
          <div>
            <p className="eyebrow mb-5">{t('addons')}</p>
            <div className="grid gap-4 pt-3 sm:grid-cols-2 lg:grid-cols-3">
              {addons.map((p) => (
                <PlanCard
                  key={p.id}
                  product={p}
                  currency={currency}
                  interval={interval}
                  mine={owned.has(p.code)}
                  busy={busyIn(p)}
                  onBuy={onBuy}
                  addonOf={service.name}
                />
              ))}
            </div>
          </div>
        )}

        {oneOff.length > 0 && (
          <div>
            {groups > 1 && <p className="eyebrow mb-5">{t('oneTimePurchases')}</p>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {oneOff.map((p) => (
                <OneOffCard
                  key={p.id}
                  product={p}
                  currency={currency}
                  busy={busyIn(p)}
                  onBuy={onBuy}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default function CatalogPage() {
  return (
    <Suspense fallback={<div className="lp" />}>
      <CatalogContent />
    </Suspense>
  );
}
