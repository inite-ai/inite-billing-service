import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';
import { LOCALE_COOKIE, LOCALE_HEADER, resolveLocale } from './locales';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  // `?locale=` (passed on by the middleware) → cookie → Accept-Language → en.
  // Only a supported value ever reaches the import below.
  const locale = resolveLocale({
    param: headerStore.get(LOCALE_HEADER),
    cookie: cookieStore.get(LOCALE_COOKIE)?.value,
    acceptLanguage: headerStore.get('accept-language'),
  });

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
